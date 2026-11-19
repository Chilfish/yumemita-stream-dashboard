/**
 * 把 content/transcripts 下的逐字稿发布到对象存储。
 *
 *   bun run ymmt publish transcripts              # 校验 + 增量上传
 *   bun run ymmt publish transcripts --no-upload  # 只校验，不联网
 *   bun run ymmt publish transcripts --force      # 忽略进度，全量重传
 *
 * 产物：
 *   <base>/<datasetId>/transcripts/<videoId>.json   正文（frontmatter + markdown 原文）
 *   <base>/transcripts/index.json                  索引，最后写
 *
 * 单篇失败（未知 dataset / 缺 videoId / 重复 videoId）只记日志并跳过，不影响其余文件；
 * 序号退出码仍是 1，方便 CI 拦住“有稿没发出去”的情况。
 *
 * 业务主体在 `runPublishTranscripts`：其它脚本（daily-update 等）直接 import 它，
 * 参数就是一个普通对象；`publishTranscriptsSpec` 只负责把 `ctx` 翻译成那份参数。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { Option } from 'commander'
import { createWriteDb } from '@/db/connection.ts'
import {
  TRANSCRIPT_INDEX_KEY,
  TRANSCRIPT_INDEX_SCHEMA,
  TRANSCRIPT_SCHEMA,
  isMemberOnlyTranscript,
  parseTranscriptFile,
  sortTranscriptEntries,
  toIndexEntry,
  transcriptObjectKey,
} from '@/lib/transcripts.ts'
import type { TranscriptIndexEntry } from '@/lib/transcripts.ts'
import type { BatchManifest } from '@/types/dataset.ts'
import { type CommandSpec, CliError, type Logger } from '@chilfish/devkit/cli'
import {
  createObjectStore,
  publishTarget,
  readCredentials,
  remoteBase,
  runPool,
} from '@scripts/lib/object-storage.ts'
import {
  digestBody,
  isUnchanged,
  publishStatePath,
  readPublishState,
  writePublishState,
} from '@scripts/lib/publish-state.ts'
import { purgeCache } from '@scripts/lib/purge.ts'
import { syncTranscripts } from '@scripts/lib/transcripts-db.ts'

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

const APP_ROOT = resolve(import.meta.dir, '../../..')
const CONTENT_ROOT = join(APP_ROOT, 'content', 'transcripts')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')

/** 默认日志器：不注入 `log` 时整条命令静默，只返回结果。 */
const silentLog: Logger = {
  name: 'publish.transcripts',
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  line: () => {},
  output: () => {},
  child: () => silentLog,
}

/** `runPublishTranscripts` 的入参：CLI 里每个 flag 的 camelCase 镜像。 */
export interface PublishTranscriptsOptions {
  /** `--no-upload`：只校验，不上传。 */
  noUpload?: boolean
  /** `--no-db`：只传对象存储，不写 transcripts 元数据。 */
  noDb?: boolean
  /** `--force`：忽略 `data/.publish-state.json` 的进度，全量重传。 */
  force?: boolean
  /** `--dry-run`：只读，不上传 / 不写库 / 不改进度 / 不失效缓存。 */
  dryRun?: boolean
  /** 进度日志；默认静默。 */
  log?: Logger
}

export interface PublishTranscriptsResult {
  exitCode: number
  data?: unknown
}

/** 以 `_` / `.` 开头的文件是草稿或模板，不参与发布。 */
function isSkipped(name: string): boolean {
  return name.startsWith('_') || name.startsWith('.')
}

export async function runPublishTranscripts(
  options: PublishTranscriptsOptions = {},
): Promise<PublishTranscriptsResult> {
  const log = options.log ?? silentLog
  const dryRun = options.dryRun === true
  const noUpload = options.noUpload === true
  const noDb = options.noDb === true
  const force = options.force === true

  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { datasets?: DatasetSource[] }
  const datasets = config.datasets ?? []
  if (datasets.length === 0)
    throw new CliError('data-sources.json 里没有 datasets', {
      hint: '在 data-sources.json 的 datasets 数组里补成员',
    })

  if (!existsSync(CONTENT_ROOT)) {
    log.info(`没有 ${relative(APP_ROOT, CONTENT_ROOT)}，无需发布`)
    return { exitCode: 0, data: { transcripts: 0, failures: 0, upload: false } }
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

  const uploadEnabled = !noUpload
  const credentials = uploadEnabled ? readCredentials() : null
  if (uploadEnabled && !credentials) {
    throw new CliError('缺少 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET', {
      hint: '在 .dev.vars 里配这四个变量；只校验请加 --no-upload',
    })
  }

  const store = credentials ? createObjectStore(credentials) : null
  // 进度文件按当下的 LOCAL 分流；模块加载后环境可能变（publish sync 会切成线上），
  // 所以放在函数里算，不提到模块顶层。
  const statePath = publishStatePath(APP_ROOT)
  const state = credentials
    ? readPublishState(statePath, publishTarget(credentials))
    : null

  const failures: string[] = []
  const transcripts: PlannedTranscript[] = []
  const seen = new Map<string, string>()
  let memberOnlySkipped = 0

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

      // 会员限定：正文只留在归档侧，不进索引、不上传、不写库。
      if (isMemberOnlyTranscript(file.frontmatter)) {
        memberOnlySkipped += 1
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
        log.warn(`${rel}：manifest 里没有 ${file.videoId}，确认 id 没写错`)

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

  log.info(
    `扫描 ${relative(APP_ROOT, CONTENT_ROOT)}：${transcripts.length} 篇可用，`
    + `${memberOnlySkipped} 篇会员限定跳过（保留归档），${failures.length} 个失败`,
  )
  for (const failure of failures) log.warn(`  x ${failure}`)
  for (const item of transcripts.slice(0, 5))
    log.info(`  · ${item.datasetId}/${item.videoId}  ${item.entry.title}`)
  if (transcripts.length > 5)
    log.info(`  · … 另有 ${transcripts.length - 5} 篇`)

  if (noUpload) {
    log.info(`校验完成，已跳过上传（--no-upload）；索引将包含 ${entries.length} 条`)
    return {
      exitCode: failures.length > 0 ? 1 : 0,
      data: {
        transcripts: transcripts.length,
        entries: entries.length,
        failures: failures.length,
        memberOnlySkipped,
        upload: false,
      },
    }
  }

  if (!store || !credentials || !state) {
    throw new CliError('缺少 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET', {
      hint: '在 .dev.vars 里配这四个变量；只校验请加 --no-upload',
    })
  }

  let remote: Map<string, number> | null = null
  // 列桶是只读的，dry-run 也照列一次，好让「待传多少篇」和真实运行一致。
  if (!force) {
    try {
      remote = await store.list()
    }
    catch (error) {
      log.warn(`列远端对象失败（${error instanceof Error ? error.message : String(error)}），只按本地进度判断；要全量重传加 --force`)
    }
  }

  const planned = transcripts.map(item => ({
    ...item,
    skip: force ? false : isUnchanged(state.objects[item.key], item.digest, remote, item.key),
  }))
  const pending = planned.filter(item => !item.skip)
  const skippedBodies = planned.length - pending.length

  if (planned.length > 0)
    log.info(`上传 ${pending.length} 篇正文（跳过 ${skippedBodies} 篇未变化）…`)

  let uploaded = 0
  let indexWritten = false
  let metadataSynced = 0

  if (dryRun) {
    log.info(`dry-run：不上传；正文 ${pending.length} 篇待传，索引 ${entries.length} 条待写`)
  }
  else {
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
        log.warn(`  x ${item.rel} 上传失败：${detail}`)
        failures.push(`${item.rel}：上传失败（${detail}）`)
      }
    })

    writePublishState(statePath, state)

    // 索引最后写：中途失败只会让索引少一篇，不会指向不存在的文件。
    const indexDigest = digestBody(indexBody)
    const indexUnchanged = !force
      && isUnchanged(state.objects[TRANSCRIPT_INDEX_KEY], indexDigest, remote, TRANSCRIPT_INDEX_KEY)

    if (transcripts.length === 0 && failures.length > 0) {
      log.warn('没有可发布的稿，保留远端现有索引不动')
    }
    else if (indexUnchanged) {
      log.info('索引未变化，跳过')
    }
    else {
      try {
        await store.put(TRANSCRIPT_INDEX_KEY, indexBody)
        state.objects[TRANSCRIPT_INDEX_KEY] = { ...indexDigest, uploadedAt: new Date().toISOString() }
        writePublishState(statePath, state)
        indexWritten = true
        log.info(`已写入 ${TRANSCRIPT_INDEX_KEY}（${entries.length} 条）`)
      }
      catch (error) {
        failures.push(`索引上传失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // 正文与索引都成功后，再写数据库元数据；列表页 / 单场页的「有没有稿」读的是这张表。
    if (!noDb && failures.length === 0) {
      const url = process.env.DATABASE_URL
      if (!url) {
        log.warn('DATABASE_URL 未配置，跳过 transcripts 元数据同步')
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
          log.info(`数据库元数据：写入 ${metadataSynced} 篇`)
        }
        catch (error) {
          failures.push(`数据库元数据同步失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    else if (failures.length > 0) {
      log.warn('有上传失败项，跳过数据库元数据同步')
    }

    // 逐字稿页是 SSR + Workers Cache；发布成功就立刻失效，不等 TTL 自然过期。
    if (failures.length === 0 && (indexWritten || metadataSynced > 0)) {
      const result = await purgeCache({ tags: ['transcripts'] })
      if (result.skipped)
        log.info(`缓存失效跳过：${result.reason}`)
      else if (result.success)
        log.info('缓存失效：transcripts')
      else
        failures.push(`缓存失效失败：${result.reason ?? `HTTP ${result.status ?? '?'}`}`)
    }
  }

  const base = remoteBase()
  log.info(
    `完成：上传 ${uploaded} 篇，跳过 ${skippedBodies} 篇`
    + `${memberOnlySkipped > 0 ? `，会员限定 ${memberOnlySkipped} 篇保留归档` : ''}`
    + `${metadataSynced > 0 ? `，元数据 ${metadataSynced} 篇` : ''}`
    + `${failures.length > 0 ? `，失败 ${failures.length} 个` : ''}${base ? ` → ${base}` : ''}`,
  )
  if (failures.length > 0)
    log.warn('有失败项，修完重新运行即可（增量发布，只会补传变化的部分）')

  return {
    exitCode: failures.length > 0 ? 1 : 0,
    data: {
      dryRun,
      upload: !dryRun,
      transcripts: transcripts.length,
      uploaded,
      skipped: skippedBodies,
      memberOnlySkipped,
      entries: entries.length,
      indexWritten,
      metadataSynced,
      failures: failures.length,
      base: base || null,
    },
  }
}

export const publishTranscriptsSpec: CommandSpec = {
  id: 'publish.transcripts',
  description: '发布逐字稿：校验 content/transcripts 并增量上传正文与索引',
  details: '产物：<base>/<datasetId>/transcripts/<videoId>.json 与 <base>/transcripts/index.json（最后写）。\n'
    + '单篇失败只记日志并跳过，其余照传；有失败项时退出码 1。\n'
    + '上传需要 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET；只校验用 --no-upload。',
  examples: [
    'bun run ymmt publish transcripts',
    'bun run ymmt publish transcripts --no-upload',
    'bun run ymmt publish transcripts --force',
    'bun run ymmt publish transcripts --dry-run --json',
  ],
  options: [
    new Option('--no-upload', '只校验，不上传'),
    new Option('--no-db', '只传对象存储，不写 transcripts 元数据'),
    new Option('--force', '忽略 data/.publish-state.json 的进度，全量重传'),
  ],
  async run(ctx) {
    const result = await runPublishTranscripts({
      // commander 把 `--no-upload` / `--no-db` 存成 `upload: false` / `db: false`（默认 true）。
      noUpload: ctx.options.upload === false,
      noDb: ctx.options.db === false,
      force: ctx.flag('force'),
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    const data = result.data as { transcripts?: number, uploaded?: number, failures?: number, upload?: boolean }
    return {
      exitCode: result.exitCode,
      data: result.data,
      summary: data.upload === false
        ? `校验完成：${data.transcripts ?? 0} 篇可用，已跳过上传`
        : `逐字稿完成：上传 ${data.uploaded ?? 0} 篇${data.failures ? `，失败 ${data.failures} 个` : ''}`,
    }
  },
}
