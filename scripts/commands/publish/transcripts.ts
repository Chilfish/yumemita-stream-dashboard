#!/usr/bin/env bun
/**
 * 把 content/transcripts 下的逐字稿发布到对象存储。
 *
 *   bun scripts/publish-transcripts.ts              # 校验 + 增量上传
 *   bun scripts/publish-transcripts.ts --no-upload  # 只校验，不联网
 *   bun scripts/publish-transcripts.ts --force      # 忽略进度，全量重传
 *
 * 产物：
 *   <base>/<datasetId>/transcripts/<videoId>.json   正文（frontmatter + markdown 原文）
 *   <base>/transcripts/index.json                  索引，最后写
 *
 * 单篇失败（未知 dataset / 缺 videoId / 重复 videoId）只记日志并跳过，不影响其余文件；
 * 序号退出码仍是 1，方便 CI 拦住“有稿没发出去”的情况。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createWriteDb } from '../src/db/connection.ts'
import {
  TRANSCRIPT_INDEX_KEY,
  TRANSCRIPT_INDEX_SCHEMA,
  TRANSCRIPT_SCHEMA,
  parseTranscriptFile,
  sortTranscriptEntries,
  toIndexEntry,
  transcriptObjectKey,
} from '../src/lib/transcripts.ts'
import type { TranscriptIndexEntry } from '../src/lib/transcripts.ts'
import type { BatchManifest } from '../src/types/dataset.ts'
import {
  createObjectStore,
  publishTarget,
  readCredentials,
  remoteBase,
  runPool,
} from './lib/object-storage.ts'
import {
  digestBody,
  isUnchanged,
  readPublishState,
  writePublishState,
} from './lib/publish-state.ts'
import { publishStatePath } from './lib/local-config.ts'
import { loadEnvFiles } from './lib/env.ts'
import { purgeCache } from './lib/purge.ts'
import { syncTranscripts } from './lib/transcripts-db.ts'

interface DatasetSource {
  id: string
  label: string
  datapackDir?: string
  manifest?: string
}

interface PlannedTranscript {
  datasetId: string
  videoId: string
  key: string
  rel: string
  body: string
  entry: TranscriptIndexEntry
  digest: ReturnType<typeof digestBody>
  skip: boolean
}

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONTENT_ROOT = join(APP_ROOT, 'content', 'transcripts')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')
const STATE_PATH = publishStatePath(APP_ROOT)

const USAGE = `用法：bun scripts/publish-transcripts.ts [选项]

校验 content/transcripts/<datasetId>/<videoId>.md，上传正文与索引到对象存储。

选项：
  --no-upload      只校验，不上传
  --no-db          只传对象存储，不写 transcripts 元数据
  --force          忽略 data/.publish-state.json 的进度，全量重传
  -h, --help       显示本帮助

上传需要环境变量：R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET；
本地模式设 LOCAL=1（走本机 SILO，默认 http://127.0.0.1:9000）`

const { values } = parseArgs({
  options: {
    'no-upload': { type: 'boolean' },
    'no-db': { type: 'boolean' },
    force: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})

function log(message: string): void {
  console.log(`[transcripts] ${message}`)
}

function warn(message: string): void {
  console.warn(`[transcripts]   ! ${message}`)
}

function fail(message: string): never {
  console.error(`[transcripts] ${message}`)
  process.exit(1)
}

if (values.help) {
  console.log(USAGE)
  process.exit(0)
}

loadEnvFiles({ prefix: 'transcripts' })

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { datasets?: DatasetSource[] }
const datasets = config.datasets ?? []
if (datasets.length === 0)
  fail('data-sources.json 里没有 datasets')

if (!existsSync(CONTENT_ROOT)) {
  log(`没有 ${relative(APP_ROOT, CONTENT_ROOT)}，无需发布`)
  process.exit(0)
}

/** 以 `_` / `.` 开头的文件是草稿或模板，不参与发布。 */
function isSkipped(name: string): boolean {
  return name.startsWith('_') || name.startsWith('.')
}

const manifestVideoIds = new Map<string, Set<string>>()

function videoIdsOf(source: DatasetSource): Set<string> | null {
  const cached = manifestVideoIds.get(source.id)
  if (cached) return cached
  const path = resolve(
    APP_ROOT,
    source.manifest ?? join(source.datapackDir ?? `data/${source.id}`, 'manifest.json'),
  )
  if (!existsSync(path)) return null
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as BatchManifest
    const ids = new Set((manifest.streams ?? []).map(stream => stream.videoId))
    manifestVideoIds.set(source.id, ids)
    return ids
  }
  catch {
    return null
  }
}

const uploadEnabled = !values['no-upload']
const credentials = uploadEnabled ? readCredentials() : null
if (uploadEnabled && !credentials)
  fail('缺少 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET；只校验请加 --no-upload')

const store = credentials ? createObjectStore(credentials) : null
const state = credentials
  ? readPublishState(STATE_PATH, publishTarget(credentials))
  : null

const failures: string[] = []
const transcripts: PlannedTranscript[] = []
const seen = new Map<string, string>()

for (const dirent of readdirSync(CONTENT_ROOT, { withFileTypes: true }).sort((a, b) =>
  a.name.localeCompare(b.name),
)) {
  if (!dirent.isDirectory() || isSkipped(dirent.name)) continue
  const datasetId = dirent.name
  const dir = join(CONTENT_ROOT, datasetId)
  const source = datasets.find(item => item.id === datasetId)

  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.md') || isSkipped(name)) continue
    const path = join(dir, name)
    const rel = relative(APP_ROOT, path)

    if (!source) {
      failures.push(`${rel}：未知 dataset「${datasetId}」，data-sources.json 里没有它`)
      continue
    }

    let file
    try {
      file = parseTranscriptFile(readFileSync(path, 'utf8'), path)
    }
    catch (error) {
      failures.push(`${rel}：${error instanceof Error ? error.message : String(error)}`)
      continue
    }

    const dedupeKey = `${datasetId}/${file.videoId}`
    const previous = seen.get(dedupeKey)
    if (previous) {
      failures.push(`${rel}：videoId ${file.videoId} 与 ${previous} 重复，同一 dataset 只能有一篇`)
      continue
    }
    seen.set(dedupeKey, rel)

    const ids = videoIdsOf(source)
    if (ids && !ids.has(file.videoId))
      warn(`${rel}：manifest 里没有 ${file.videoId}，确认 id 没写错`)

    const mtime = statSync(path).mtime.toISOString()
    const normalized = { ...file, datasetId }
    const key = transcriptObjectKey(datasetId, file.videoId)
    const previousEntry = state?.objects[key]
    const build = (updatedAt: string) => {
      const body = JSON.stringify({
        schema: TRANSCRIPT_SCHEMA,
        datasetId,
        videoId: file.videoId,
        frontmatter: file.frontmatter,
        markdown: file.markdown,
        updatedAt,
      })
      return { body, entry: toIndexEntry(normalized, updatedAt), digest: digestBody(body) }
    }

    // 内容没变时沿用上次记录的时间：CI 每天 checkout 会改 mtime，不能让它触发全量重传。
    let built = build(previousEntry?.contentUpdatedAt ?? mtime)
    const unchanged = previousEntry != null
      && previousEntry.sha256 === built.digest.sha256
      && previousEntry.size === built.digest.size
    if (!unchanged && built.entry.updatedAt !== mtime)
      built = build(mtime)

    transcripts.push({
      datasetId,
      videoId: file.videoId,
      key,
      rel,
      body: built.body,
      entry: built.entry,
      digest: built.digest,
      skip: false,
    })
  }
}

const entries = sortTranscriptEntries(transcripts.map(item => item.entry))
// 用条目里的最新时间，而不是当前时刻：内容没变时索引也不该每天变一次。
const generatedAt = entries.reduce(
  (latest, entry) => (entry.updatedAt > latest ? entry.updatedAt : latest),
  '',
) || new Date(0).toISOString()
const indexBody = JSON.stringify({
  schema: TRANSCRIPT_INDEX_SCHEMA,
  generatedAt,
  entries,
})

log(`扫描 ${relative(APP_ROOT, CONTENT_ROOT)}：${transcripts.length} 篇可用，${failures.length} 个失败`)
for (const failure of failures) console.warn(`[transcripts]   x ${failure}`)
for (const item of transcripts.slice(0, 5))
  log(`  · ${item.datasetId}/${item.videoId}  ${item.entry.title}`)
if (transcripts.length > 5)
  log(`  · … 另有 ${transcripts.length - 5} 篇`)

const exitCode = failures.length > 0 ? 1 : 0

if (values['no-upload']) {
  log(`校验完成，已跳过上传（--no-upload）；索引将包含 ${entries.length} 条`)
  process.exit(exitCode)
}

if (!store || !credentials || !state)
  fail('缺少 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET；只校验请加 --no-upload')

let remote: Map<string, number> | null = null
if (!values.force) {
  try {
    remote = await store.list()
  }
  catch (error) {
    warn(`列远端对象失败（${error instanceof Error ? error.message : String(error)}），只按本地进度判断；要全量重传加 --force`)
  }
}

const planned = transcripts.map(item => ({
  ...item,
  skip: !values.force && isUnchanged(state.objects[item.key], item.digest, remote, item.key),
}))
const pending = planned.filter(item => !item.skip)
const skippedBodies = planned.length - pending.length

if (planned.length > 0)
  log(`上传 ${pending.length} 篇正文（跳过 ${skippedBodies} 篇未变化）…`)

let uploaded = 0
await runPool(pending, 4, async (item) => {
  try {
    await store.put(item.key, item.body)
    state.objects[item.key] = {
      ...item.digest,
      uploadedAt: new Date().toISOString(),
      contentUpdatedAt: item.entry.updatedAt,
    }
    uploaded += 1
  }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.warn(`[transcripts]   x ${item.rel} 上传失败：${detail}`)
    failures.push(`${item.rel}：上传失败（${detail}）`)
  }
})

writePublishState(STATE_PATH, state)

// 索引最后写：中途失败只会让索引少一篇，不会指向不存在的文件。
const indexDigest = digestBody(indexBody)
const indexUnchanged = !values.force
  && isUnchanged(state.objects[TRANSCRIPT_INDEX_KEY], indexDigest, remote, TRANSCRIPT_INDEX_KEY)

let indexWritten = false
if (transcripts.length === 0 && failures.length > 0) {
  warn('没有可发布的稿，保留远端现有索引不动')
}
else if (indexUnchanged) {
  log('索引未变化，跳过')
}
else {
  try {
    await store.put(TRANSCRIPT_INDEX_KEY, indexBody)
    state.objects[TRANSCRIPT_INDEX_KEY] = { ...indexDigest, uploadedAt: new Date().toISOString() }
    writePublishState(STATE_PATH, state)
    indexWritten = true
    log(`已写入 ${TRANSCRIPT_INDEX_KEY}（${entries.length} 条）`)
  }
  catch (error) {
    failures.push(`索引上传失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

// 正文与索引都成功后，再写数据库元数据；列表页 / 单场页的「有没有稿」读的是这张表。
let metadataSynced = 0
if (!values['no-db'] && failures.length === 0) {
  const url = process.env.DATABASE_URL
  if (!url) {
    warn('DATABASE_URL 未配置，跳过 transcripts 元数据同步')
  }
  else {
    try {
      const datasetIds = [...new Set(transcripts.map(item => item.datasetId))]
      const { db, pool } = createWriteDb(url)
      try {
        for (const datasetId of datasetIds)
          metadataSynced += await syncTranscripts(db, datasetId)
      }
      finally {
        await pool.end()
      }
      log(`数据库元数据：写入 ${metadataSynced} 篇`)
    }
    catch (error) {
      failures.push(`数据库元数据同步失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
else if (failures.length > 0) {
  warn('有上传失败项，跳过数据库元数据同步')
}

// 逐字稿页是 SSR + Workers Cache；发布成功就立刻失效，不等 TTL 自然过期。
if (failures.length === 0 && (indexWritten || metadataSynced > 0)) {
  const result = await purgeCache({ tags: ['transcripts'] })
  if (result.skipped)
    log(`缓存失效跳过：${result.reason}`)
  else if (result.success)
    log('缓存失效：transcripts')
  else
    failures.push(`缓存失效失败：${result.reason ?? `HTTP ${result.status ?? '?'}`}`)
}

const base = remoteBase()
log(
  `完成：上传 ${uploaded} 篇，跳过 ${skippedBodies} 篇`
  + `${metadataSynced > 0 ? `，元数据 ${metadataSynced} 篇` : ''}`
  + `${failures.length > 0 ? `，失败 ${failures.length} 个` : ''}${base ? ` → ${base}` : ''}`,
)
if (failures.length > 0)
  console.warn('[transcripts] 有失败项，修完重新运行即可（增量发布，只会补传变化的部分）')

process.exit(failures.length > 0 ? 1 : 0)
