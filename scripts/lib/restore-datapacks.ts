/**
 * 从对象存储把某个 dataset 的 manifest 与 datapack 拉回本地暂存区。
 *
 * `fetch-streams` 用本地 `data/<id>/manifest.json` 判断哪些场次已经抓过。换设备、
 * 清掉缓存后本地什么都没有，直接续跑会把整个频道重抓一遍。这里先把远端已有的
 * pack 恢复回来，让「已入库」判定和 `publish:data` 的「本地 pack 是唯一真源」都成立。
 *
 * 读取顺序：先试 `DATAPACK_BASE` / `VITE_DATAPACK_BASE`（公开地址，不需要凭据），
 * 失败时再试 `R2_*`（私有桶）。已存在的 pack 不重复下载，可反复执行。
 */
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createObjectStore,
  datapackKey,
  manifestKey,
  readCredentials,
  remoteBase,
  runPool,
} from './object-storage.ts'

const PACK_SCHEMAS = new Set(['yumemita.stream-datapack/v1', 'yumemita.stream-datapack/v2'])
const PACK_SUFFIX = '.datapack.json'

interface ManifestStream {
  videoId?: string
}

interface RemoteManifest {
  streams?: ManifestStream[]
}

interface Reader {
  label: string
  read: (key: string) => Promise<string | null>
}

export interface RestoreOptions {
  datasetId: string
  /** 本地暂存目录，例如 data/yuno。 */
  datapackDir: string
  /** 本地 manifest 路径，例如 data/yuno/manifest.json。 */
  manifestPath: string
  /** 下载并发，默认 8。 */
  concurrency?: number
  /** 远端 manifest 存在时也覆盖本地（默认只在本地缺失时写入）。 */
  overwriteManifest?: boolean
}

export interface RestoreResult {
  /** 实际尝试过的远端来源；没有配置任何来源时为空。 */
  sources: string[]
  manifest: 'remote' | 'local' | 'missing'
  /** 本次下载的 pack 数量。 */
  restored: number
  /** 恢复后本地 pack 总数。 */
  present: number
  /** 远端清单里有、但没拉到本地的 videoId。 */
  failed: string[]
}

function httpReader(base: string): Reader {
  return {
    label: base,
    async read(key) {
      const response = await fetch(`${base}/${key}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      })
      if (response.status === 404)
        return null
      if (!response.ok)
        throw new Error(`HTTP ${response.status}`)
      return await response.text()
    },
  }
}

function createReaders(): Reader[] {
  const readers: Reader[] = []
  const base = remoteBase()
  if (base)
    readers.push(httpReader(base))

  const credentials = readCredentials()
  if (credentials) {
    const store = createObjectStore(credentials)
    readers.push({
      label: `s3://${credentials.bucket}/${credentials.prefix}`,
      read: key => store.get(key),
    })
  }
  return readers
}

function localPackIds(datapackDir: string): Set<string> {
  const ids = new Set<string>()
  if (!existsSync(datapackDir))
    return ids
  for (const name of readdirSync(datapackDir)) {
    if (name.endsWith(PACK_SUFFIX))
      ids.add(name.slice(0, -PACK_SUFFIX.length))
  }
  return ids
}

function parseManifest(text: string): RemoteManifest | null {
  try {
    const value = JSON.parse(text) as RemoteManifest
    return Array.isArray(value.streams) ? value : null
  }
  catch {
    return null
  }
}

function writeAtomic(path: string, body: string): void {
  const temp = `${path}.tmp-${process.pid}`
  writeFileSync(temp, body, 'utf8')
  renameSync(temp, path)
}

export async function restoreDataset(options: RestoreOptions): Promise<RestoreResult> {
  const concurrency = options.concurrency ?? 8
  const datapackDir = options.datapackDir
  mkdirSync(datapackDir, { recursive: true })

  const local = localPackIds(datapackDir)
  const readers = createReaders()
  if (readers.length === 0) {
    return {
      sources: [],
      manifest: existsSync(options.manifestPath) ? 'local' : 'missing',
      restored: 0,
      present: local.size,
      failed: [],
    }
  }

  async function readFrom(pool: Reader[], key: string): Promise<{ text: string | null, reader: Reader | null }> {
    let lastError: unknown
    let sawMissing = false
    for (const reader of pool) {
      try {
        const text = await reader.read(key)
        if (text != null)
          return { text, reader }
        sawMissing = true
      }
      catch (error) {
        lastError = error
        console.warn(`[restore] ${reader.label} 读取 ${key} 失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (lastError && !sawMissing)
      throw lastError
    return { text: null, reader: null }
  }

  // manifest 命中的来源优先用于 pack 下载：公开地址 404 时不必为每份 pack 再试一次。
  let packReaders = readers

  let remoteManifest: RemoteManifest | null = null
  let manifestState: RestoreResult['manifest'] = existsSync(options.manifestPath) ? 'local' : 'missing'
  try {
    const manifestRead = await readFrom(readers, manifestKey(options.datasetId))
    const text = manifestRead.text
    if (manifestRead.reader) {
      packReaders = [manifestRead.reader, ...readers.filter(reader => reader !== manifestRead.reader)]
    }
    if (text) {
      remoteManifest = parseManifest(text)
      if (!remoteManifest) {
        console.warn(`[restore] ${options.datasetId}/manifest.json 不是有效清单，忽略`)
      }
      else if (options.overwriteManifest || !existsSync(options.manifestPath)) {
        writeAtomic(options.manifestPath, text.endsWith('\n') ? text : `${text}\n`)
        manifestState = 'remote'
      }
    }
  }
  catch (error) {
    console.warn(`[restore] 拉取 manifest 失败：${error instanceof Error ? error.message : String(error)}`)
  }

  const ids = new Set<string>()
  for (const stream of remoteManifest?.streams ?? []) {
    if (stream.videoId)
      ids.add(stream.videoId)
  }

  // 远端没有 manifest 时（或清单不全时）用列桶兜底。
  if (remoteManifest == null && readers.length > 0) {
    const credentials = readCredentials()
    if (credentials) {
      try {
        const objects = await createObjectStore(credentials).list()
        const prefix = `${options.datasetId}/`
        for (const key of objects.keys()) {
          if (key.startsWith(prefix) && key.endsWith(PACK_SUFFIX))
            ids.add(key.slice(prefix.length, -PACK_SUFFIX.length))
        }
      }
      catch (error) {
        console.warn(`[restore] 列桶失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  const pending = [...ids].filter(id => !local.has(id))
  let restored = 0
  const failed: string[] = []

  await runPool(pending, concurrency, async (id) => {
    try {
      const { text } = await readFrom(packReaders, datapackKey(options.datasetId, id))
      if (text == null)
        throw new Error('远端不存在')
      const pack = JSON.parse(text) as { schema?: string, video?: { id?: string } }
      if (!PACK_SCHEMAS.has(pack.schema ?? ''))
        throw new Error(`schema 不匹配：${pack.schema ?? '(缺失)'}`)
      if (pack.video?.id !== id)
        throw new Error(`video.id 不匹配：${pack.video?.id ?? '(缺失)'}`)
      writeAtomic(join(datapackDir, `${id}${PACK_SUFFIX}`), text.endsWith('\n') ? text : `${text}\n`)
      restored += 1
    }
    catch (error) {
      failed.push(id)
      console.warn(`[restore] ${id} 恢复失败：${error instanceof Error ? error.message : String(error)}`)
    }
  })

  return {
    sources: readers.map(reader => reader.label),
    manifest: manifestState,
    restored,
    present: localPackIds(datapackDir).size,
    failed,
  }
}
