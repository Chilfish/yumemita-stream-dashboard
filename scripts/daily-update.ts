#!/usr/bin/env bun
/**
 * 每日增量更新：频道列表 → 只处理有变化的场次 → 补封面 → 定点发布。
 *
 *   bun scripts/daily-update.ts                    # 正常增量（本地用 Firefox cookie）
 *   bun scripts/daily-update.ts --force            # 额外重抓最近 24 小时
 *   bun scripts/daily-update.ts --dataset nonoka   # 只跑一位成员
 *   bun scripts/daily-update.ts --dry-run          # 只列出这次会动哪些场次
 *   bun scripts/daily-update.ts --no-publish       # 只抓本地，不传对象存储
 *
 * 设计要点：
 *   - 先拉频道 `/streams`（flat-playlist，不需要 cookie），和**数据库里的 streams** 求差集；
 *     没有新场次且没有待补数据的成员直接跳过，不恢复、不 ingest。
 *   - 有变化才对该成员 `--restore`（补齐远端 pack，保证 insights 精确），
 *     然后 ingest 数据库、发布封面 / 表情 / archive，其余成员不下载、不上传。
 *   - `--force` 重抓最近 24 小时；平时也会重试近期缺 VSTATS / 缺弹幕的场次，
 *     避免回放或 VSTATS 页面还没生成时被永久判死。
 *   - 发布顺序：抓取 → ingest → 资产 → 逐字稿 → purge；数据库提交成功后才失效缓存。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { inArray } from 'drizzle-orm'
import { runBatch } from '../src/db/batch.ts'
import { createDb } from '../src/db/connection.ts'
import { datasetInsights, streams } from '../src/db/schema.ts'
import { CACHE_TAGS, datasetTag, streamTag } from '../src/lib/cache-tags.ts'
import { loadEnvFiles, requireEnv } from './lib/env.ts'
import { purgeCache } from './lib/purge.ts'
import { syncScheduleFromChannel } from './lib/schedule-sync.ts'
import { planDataset, type ChannelEntry, type PlanStream } from './lib/update-plan.ts'
import { resolveCookies, ytdlpCookieArgs } from './lib/yt-cookies.ts'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')
const FETCH_SCRIPT = join(APP_ROOT, 'scripts', 'fetch-streams.ts')
const THUMB_SCRIPT = join(APP_ROOT, 'scripts', 'fetch-thumbnails.ts')
const INGEST_SCRIPT = join(APP_ROOT, 'scripts', 'ingest-db.ts')
const PUBLISH_SCRIPT = join(APP_ROOT, 'scripts', 'publish-data.ts')
const TRANSCRIPT_SCRIPT = join(APP_ROOT, 'scripts', 'publish-transcripts.ts')

const FORCE_RECENT_HOURS = 24
const PACK_SUFFIX = '.datapack.json'

interface DatasetSource {
  id: string
  label: string
  channelId?: string
  manifest: string
  datapackDir: string
}

interface LoadedState {
  streams: PlanStream[]
  /** dataset_insights.generated_at；用来判断本地 pack 是否还没 ingest。 */
  generatedAt: string | null
  from: 'database'
}

const OPTIONS = {
  dataset: { type: 'string' },
  root: { type: 'string' },
  'state-dir': { type: 'string' },
  concurrency: { type: 'string', default: '3' },
  cookies: { type: 'string' },
  'cookies-from-browser': { type: 'string', default: 'firefox' },
  'cookie-cache': { type: 'string' },
  'no-cookies': { type: 'boolean' },
  force: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  'no-publish': { type: 'boolean' },
  bootstrap: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const

const USAGE = `用法：bun scripts/daily-update.ts [选项]

按频道 /streams 列表和数据库里的 streams 求差集，只抓有变化的场次。
抓取后依次运行 ingest、资产发布、逐字稿发布与缓存失效。

选项：
  --dataset <id>              只处理一个 dataset；默认全部
  --root <目录>               原始会话目录（默认 $STREAM_SESSION_ROOT 或 ./temp/youtube-live）
  --state-dir <目录>          进度/频道缓存（默认 <root>/.fetch-state）
  --concurrency <n>           抓取并发，默认 3
  --cookies <文件>            Netscape cookie jar；CI 用这个
  --cookies-from-browser <b>  导出 cookie 时用哪个浏览器，默认 firefox
  --cookie-cache <文件>       cookie 缓存路径，默认 ~/yt-cookies.txt
  --no-cookies                不使用 cookie，以匿名状态抓取
  --force                     额外重抓最近 ${FORCE_RECENT_HOURS} 小时结束的场次
  --dry-run                   只列候选，不抓取、不写库、不发布
  --no-publish                只写本地，不写库、不上传对象存储
  --bootstrap                 数据库为空时也允许按全量新场次处理
  -h, --help                  显示本帮助

写入数据库需要 DATABASE_URL；发布资产需要 R2_* 凭据；缓存失效需要 SITE_URL + PURGE_TOKEN。`

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function runCapture(command: string, args: string[], env?: Record<string, string>): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : process.env,
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout?.on('data', chunk => out.push(chunk as Buffer))
    child.stderr?.on('data', chunk => err.push(chunk as Buffer))
    child.on('error', rejectPromise)
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(out).toString('utf8'))
        return
      }
      const stderr = Buffer.concat(err).toString('utf8').trim().split('\n').slice(-3).join(' | ')
      rejectPromise(new Error(`${command} exit ${code}${stderr ? `：${stderr}` : ''}`))
    })
  })
}

function runScript(script: string, args: string[]): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit' })
    child.on('error', rejectPromise)
    child.on('close', code => resolvePromise(code ?? 1))
  })
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const time = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

interface DatabaseStreamRow {
  datasetId: string
  videoId: string
  title: string | null
  durationSec: number | null
  startedAt: Date | string | null
  endedAt: Date | string | null
  availability: string | null
  vstatsViews: number | null
  avgConcurrent: string | number | null
  chatTotal: number | null
}

/** 已入库的场次与 insights 时间：数据库是「哪些场次已经有了」的唯一来源。 */
async function loadDatabaseStates(
  db: ReturnType<typeof createDb>,
  sources: DatasetSource[],
): Promise<Map<string, LoadedState>> {
  const ids = sources.map(source => source.id)
  const [rows, insights] = await runBatch<[
    DatabaseStreamRow[],
    { datasetId: string, generatedAt: Date | string | null }[],
  ]>(db, [
    db
      .select({
        datasetId: streams.datasetId,
        videoId: streams.videoId,
        title: streams.title,
        durationSec: streams.durationSec,
        startedAt: streams.startedAt,
        endedAt: streams.endedAt,
        availability: streams.availability,
        vstatsViews: streams.vstatsViews,
        avgConcurrent: streams.avgConcurrent,
        chatTotal: streams.chatTotal,
      })
      .from(streams)
      .where(inArray(streams.datasetId, ids)),
    db
      .select({ datasetId: datasetInsights.datasetId, generatedAt: datasetInsights.generatedAt })
      .from(datasetInsights)
      .where(inArray(datasetInsights.datasetId, ids)),
  ])

  const byDataset = new Map<string, PlanStream[]>()
  for (const row of rows) {
    const list = byDataset.get(row.datasetId) ?? []
    list.push({
      videoId: row.videoId,
      title: row.title ?? null,
      durationSec: row.durationSec ?? null,
      startedAt: isoOrNull(row.startedAt),
      endedAt: isoOrNull(row.endedAt),
      availability: row.availability ?? null,
      vstatsViews: row.vstatsViews ?? null,
      avgConcurrent: row.avgConcurrent == null ? null : Number(row.avgConcurrent),
      chatTotal: row.chatTotal ?? null,
    })
    byDataset.set(row.datasetId, list)
  }

  const generatedAt = new Map(insights.map(row => [row.datasetId, isoOrNull(row.generatedAt)]))

  return new Map(sources.map(source => [source.id, {
    streams: byDataset.get(source.id) ?? [],
    generatedAt: generatedAt.get(source.id) ?? null,
    from: 'database' as const,
  }]))
}

/** 本地暂存区的 pack 数量与最新修改时间，用来发现「抓到了但 ingest 没成功」的场次。 */
function localPackState(source: DatasetSource): { count: number, newest: number | null } {
  const dir = resolve(APP_ROOT, source.datapackDir)
  if (!existsSync(dir)) return { count: 0, newest: null }
  let count = 0
  let newest: number | null = null
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(PACK_SUFFIX)) continue
    count += 1
    const mtime = statSync(join(dir, name)).mtimeMs
    if (newest == null || mtime > newest) newest = mtime
  }
  return { count, newest }
}

/** 最近 N 天改过的 pack；没有明确 new/force ID 时，用它做定点 ingest / publish。 */
function recentPackIds(source: DatasetSource, days = 7): string[] {
  const dir = resolve(APP_ROOT, source.datapackDir)
  if (!existsSync(dir)) return []
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return readdirSync(dir)
    .filter(name => name.endsWith(PACK_SUFFIX))
    .filter((name) => {
      try {
        return statSync(join(dir, name)).mtimeMs >= cutoff
      }
      catch {
        return false
      }
    })
    .map(name => name.slice(0, -PACK_SUFFIX.length))
}

interface ChannelList {
  entries: ChannelEntry[]
  /** 频道列表没拿到（网络 / bot 检查 / 没缓存）：本次可能漏掉新场次，要记失败。 */
  failed: boolean
}

/**
 * 频道 `/streams` 列表。用 `-J` 而不是 `--print`：标题里可能有制表符/换行，
 * 按行切分会错位；同时强制 UTF-8，避免 Windows 控制台编码把日文标题弄坏。
 */
async function readChannelEntries(source: DatasetSource, stateDir: string): Promise<ChannelList> {
  const cachePath = join(stateDir, `channel-${source.id}.json`)
  if (!source.channelId) {
    console.warn(`[update] ${source.id} 缺少 channelId，跳过频道列表`)
    return { entries: existsSync(cachePath) ? readChannelCache(cachePath) : [], failed: true }
  }

  try {
    const proxy = process.env.YTDLP_PROXY
    const raw = await runCapture('yt-dlp', [
      '--flat-playlist',
      '--no-warnings',
      '--socket-timeout',
      '30',
      '--retries',
      '3',
      '-J',
      ...(proxy ? ['--proxy', proxy] : []),
      `https://www.youtube.com/channel/${source.channelId}/streams`,
    ], { PYTHONIOENCODING: 'utf-8' })
    const playlist = JSON.parse(raw) as {
      entries?: {
        id?: unknown
        title?: unknown
        duration?: unknown
        live_status?: unknown
        release_timestamp?: unknown
        timestamp?: unknown
      }[]
    }
    const entries: ChannelEntry[] = []
    for (const entry of playlist.entries ?? []) {
      if (typeof entry?.id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(entry.id))
        continue
      const timestamp = typeof entry.release_timestamp === 'number'
        ? entry.release_timestamp
        : typeof entry.timestamp === 'number'
          ? entry.timestamp
          : null
      entries.push({
        id: entry.id,
        title: typeof entry.title === 'string' ? entry.title : null,
        durationSec: typeof entry.duration === 'number' ? entry.duration : null,
        liveStatus: typeof entry.live_status === 'string' ? entry.live_status : null,
        scheduledAt: timestamp && timestamp > 0
          ? new Date(timestamp * 1000).toISOString()
          : null,
      })
    }
    if (entries.length > 0) {
      writeFileSync(cachePath, `${JSON.stringify({ updatedAt: new Date().toISOString(), entries })}\n`, 'utf8')
      return { entries, failed: false }
    }
    console.warn(`[update] ${source.id} 频道列表为空`)
  }
  catch (error) {
    console.warn(`[update] ${source.id} 频道列表抓取失败：${describe(error)}`)
  }

  if (existsSync(cachePath)) {
    const cached = readChannelCache(cachePath)
    console.warn(`[update] ${source.id} 使用频道列表缓存（${cached.length} 条），本次可能漏掉新场次`)
    return { entries: cached, failed: true }
  }
  console.warn(`[update] ${source.id} 没有频道列表缓存，本次只能处理待补数据的场次`)
  return { entries: [], failed: true }
}

function readChannelCache(path: string): ChannelEntry[] {
  try {
    const cache = readJson<{ entries?: ChannelEntry[] }>(path)
    return (cache.entries ?? []).filter(entry => Boolean(entry?.id))
  }
  catch {
    return []
  }
}

async function main(): Promise<void> {
  loadEnvFiles()
  const { values } = parseArgs({ options: OPTIONS, args: process.argv.slice(2), allowPositionals: false })
  if (values.help) {
    console.log(USAGE)
    return
  }

  const sources = readJson<{ datasets?: DatasetSource[] }>(CONFIG_PATH).datasets ?? []
  const selected = values.dataset ? sources.filter(item => item.id === values.dataset) : sources
  if (selected.length === 0) {
    console.error(`[update] 找不到 dataset：${values.dataset ?? '(data-sources.json 为空)'}`)
    console.error(`[update] 可用：${sources.map(item => item.id).join(', ') || '(空)'}`)
    process.exit(1)
  }

  const root = resolve(values.root ?? process.env.STREAM_SESSION_ROOT ?? join(APP_ROOT, 'temp', 'youtube-live'))
  const dataRoot = join(APP_ROOT, 'data')
  if (root === dataRoot || root.startsWith(`${dataRoot}${sep}`)) {
    console.error('[update] --root 是原始素材目录，不能指向 data/')
    process.exit(1)
  }
  const stateDir = resolve(values['state-dir'] ?? join(root, '.fetch-state'))
  mkdirSync(root, { recursive: true })
  mkdirSync(stateDir, { recursive: true })
  // 安静日不会走到 publish，但 CI 的 data/ 缓存需要一个真实存在的目录。
  mkdirSync(dataRoot, { recursive: true })

  const concurrency = Number(values.concurrency)
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    console.error('[update] --concurrency 需要是 >= 1 的整数')
    process.exit(1)
  }
  // cookie 默认每次运行重新导出到 ~/yt-cookies.txt；CI 走显式 --cookies 文件。
  const resolvedCookies = await resolveCookies({
    cookies: values.cookies,
    envCookie: process.env.YT_COOKIE,
    browser: values['cookies-from-browser'],
    cachePath: values['cookie-cache'],
    disable: values['no-cookies'],
    appRoot: APP_ROOT,
    log: line => console.log(`[update] ${line}`),
  })
  const cookieArgs = ytdlpCookieArgs(resolvedCookies, { browser: values['cookies-from-browser'] })
  const dryRun = Boolean(values['dry-run'])
  const noPublish = Boolean(values['no-publish'])

  const db = createDb(requireEnv('DATABASE_URL'))
  const states = await loadDatabaseStates(db, selected)

  let failures = 0
  let newTotal = 0
  let forcedTotal = 0
  let published = 0
  let transcriptsPublished = false
  const purgeTags = new Set<string>()

  for (const source of selected) {
    console.log(`\n[update] === ${source.label} (${source.id}) ===`)
    const state = states.get(source.id) ?? { streams: [], generatedAt: null, from: 'database' as const }
    const knownIds = state.streams.map(stream => stream.videoId)
    console.log(`[update] 数据库：${knownIds.length} 场（${state.from}）`)

    const channelList = await readChannelEntries(source, stateDir)
    const channel = channelList.entries
    if (channel.length === 0 && knownIds.length === 0) {
      console.warn(`[update] ${source.id} 既没有频道列表也没有已入库场次，跳过`)
      failures += 1
      continue
    }
    if (knownIds.length === 0 && channel.length > 20 && !values.bootstrap) {
      console.error(`[update] ${source.id} 数据库里还没有场次，但频道有 ${channel.length} 条；`)
      console.error('[update] 拒绝把整个频道当成新场次。确认要首次建档时加 --bootstrap。')
      failures += 1
      continue
    }

    // 未来场只写日程表；开播结束后仍由下面的 ingest 写入 streams。
    // 频道列表失败时用的是缓存，可能已经过期，不写日程。
    if (!channelList.failed && !dryRun && !noPublish) {
      try {
        const schedule = await syncScheduleFromChannel(db, source.id, channel, {
          knownIds: new Set(knownIds),
        })
        if (schedule.changed) {
          purgeTags.add(CACHE_TAGS.schedule)
          console.log(`[update] ${source.id} 日程：预定 ${schedule.upserted}，直播中 ${schedule.live}`)
        }
      }
      catch (error) {
        failures += 1
        console.warn(`[update] ${source.id} 日程同步失败：${describe(error)}`)
      }
    }

    const plan = planDataset({
      channel,
      knownIds,
      streams: state.streams,
      forceRecentHours: values.force ? FORCE_RECENT_HOURS : 0,
    })

    console.log(`[update] 计划：新场次 ${plan.newIds.length}，重抓 ${plan.forceIds.length}，暂缓 ${plan.deferredIds.length}`)
    if (plan.newIds.length > 0)
      console.log(`[update]   新：${plan.newIds.slice(0, 10).join(', ')}${plan.newIds.length > 10 ? ` 等 ${plan.newIds.length} 场` : ''}`)
    if (plan.forceIds.length > 0) {
      const detail = plan.forceIds.slice(0, 10).map(id => `${id}(${plan.reasons.get(id) ?? '重抓'})`).join(', ')
      console.log(`[update]   重抓：${detail}${plan.forceIds.length > 10 ? ` 等 ${plan.forceIds.length} 场` : ''}`)
    }
    if (plan.expiredIds.length > 0) {
      const detail = plan.expiredIds.slice(0, 10).map(id => `${id}(${plan.reasons.get(id) ?? '已过期'})`).join(', ')
      console.log(`[update]   已放弃：${detail}${plan.expiredIds.length > 10 ? ` 等 ${plan.expiredIds.length} 场` : ''}`)
    }

    // 上次抓取成功但 ingest 失败（或本地用了 --no-publish）时，本地 pack 会比数据库新；
    // 这种日子没有新场次也要补一次 ingest，否则改动会一直卡在本地。
    const local = localPackState(source)
    const localAhead = local.count > state.streams.length
      || (state.generatedAt == null
        ? local.count > 0
        : local.newest != null && local.newest > Date.parse(state.generatedAt))
    if (localAhead)
      console.log('[update] 本地 pack 还没入库，本次补 ingest')

    const hasFetchWork = plan.newIds.length > 0 || plan.forceIds.length > 0
    if (!hasFetchWork && !localAhead) {
      if (channelList.failed) {
        console.warn(`[update] ${source.id} 没有可处理的变化，但频道列表不可用；记一次失败`)
        failures += 1
      }
      else {
        console.log(`[update] ${source.id} 没有变化，跳过`)
      }
      continue
    }
    if (dryRun) {
      console.log(`[update] ${source.id} dry-run，不抓取也不发布`)
      continue
    }

    newTotal += plan.newIds.length
    forcedTotal += plan.forceIds.length

    // 频道列表失败时本次可能漏掉新场次；继续处理待补数据的场次，但结果记为失败。
    let datasetFailed = channelList.failed

    // 正常增量：只把这次判定要抓的场次交给 fetch-streams，
    // 未来场/摘要不会被重新拉一遍元信息。
    if (plan.newIds.length > 0) {
      const idsFile = join(stateDir, `daily-ids-${source.id}.txt`)
      writeFileSync(idsFile, `${plan.newIds.join('\n')}\n`, 'utf8')
      console.log(`[update] ${source.id} 抓取新场次…`)
      const code = await runScript(FETCH_SCRIPT, [
        '--dataset', source.id,
        '--root', root,
        '--ids', idsFile,
        '--restore',
        '--no-publish',
        '--concurrency', String(concurrency),
        ...cookieArgs,
      ])
      if (code !== 0) {
        datasetFailed = true
        console.warn(`[update] ${source.id} 新场次抓取有失败项（exit ${code}）`)
      }
    }

    // 定点重抓：最近 24 小时 + 缺 VSTATS / 缺弹幕。
    if (plan.forceIds.length > 0) {
      console.log(`[update] ${source.id} 重抓 ${plan.forceIds.length} 场…`)
      const code = await runScript(FETCH_SCRIPT, [
        '--dataset', source.id,
        '--root', root,
        '--force', plan.forceIds.join(','),
        '--restore',
        '--no-publish',
        '--concurrency', String(concurrency),
        ...cookieArgs,
      ])
      if (code !== 0) {
        datasetFailed = true
        console.warn(`[update] ${source.id} 重抓有失败项（exit ${code}）`)
      }
    }

    if (noPublish) {
      console.log(`[update] ${source.id} --no-publish，跳过封面与发布`)
      continue
    }

    // 只补发布时没有新场次，不需要碰封面（空 --ids 不能当成“全部”）。
    const thumbIds = unique([...plan.newIds, ...plan.forceIds])
    if (thumbIds.length > 0) {
      const thumbFile = join(stateDir, `daily-thumbs-${source.id}.txt`)
      writeFileSync(thumbFile, `${thumbIds.join('\n')}\n`, 'utf8')
      const thumbCode = await runScript(THUMB_SCRIPT, [
        '--dataset', source.id,
        '--ids', thumbFile,
      ])
      if (thumbCode !== 0) {
        datasetFailed = true
        console.warn(`[update] ${source.id} 封面补抓有失败项（exit ${thumbCode}）`)
      }
    }

    // 本次真正会变动的 ID：计划里的新场 / 重抓场；没有明确 ID 时退回最近 7 天改过的 pack。
    // 把它传给 ingest / publish，避免每次都扫全量 pack、查全量 hash。
    const changedIds = thumbIds.length > 0 ? thumbIds : recentPackIds(source)
    const changedFile = changedIds.length > 0
      ? join(stateDir, `daily-changed-${source.id}.txt`)
      : null
    if (changedFile)
      writeFileSync(changedFile, `${changedIds.join('\n')}\n`, 'utf8')

    // 逐字稿先上传正文，随后 ingest 才会把新稿的元数据同步进数据库。
    if (!transcriptsPublished) {
      console.log('[update] 发布逐字稿…')
      const transcriptCode = await runScript(TRANSCRIPT_SCRIPT, [])
      if (transcriptCode !== 0) {
        datasetFailed = true
        console.warn(`[update] 逐字稿发布有失败项（exit ${transcriptCode}）`)
      }
      else {
        transcriptsPublished = true
        purgeTags.add(CACHE_TAGS.transcripts)
      }
    }

    console.log(`[update] ${source.id} 写入数据库…`)
    const ingestCode = await runScript(INGEST_SCRIPT, [
      '--dataset', source.id,
      ...(changedFile ? ['--ids', changedFile] : []),
    ])
    const ingestOk = ingestCode === 0
    if (!ingestOk) {
      datasetFailed = true
      console.warn(`[update] ${source.id} ingest 失败（exit ${ingestCode}）`)
    }

    console.log(`[update] ${source.id} 发布资产…`)
    const publishCode = await runScript(PUBLISH_SCRIPT, [
      '--dataset', source.id,
      '--assets-only',
      ...(changedFile ? ['--ids', changedFile] : []),
    ])
    if (publishCode !== 0) {
      datasetFailed = true
      console.warn(`[update] ${source.id} 资产发布失败（exit ${publishCode}）`)
    }

    // 数据库已提交即可失效页面缓存；资产失败只影响封面，不该挡住数据更新。
    if (ingestOk) {
      purgeTags.add(datasetTag(source.id))
      // 宽 tag 只由 routeRules 写入；不一起清会留下只能等 TTL 的条目。
      purgeTags.add(CACHE_TAGS.datasets)
      purgeTags.add(CACHE_TAGS.group)
      purgeTags.add(CACHE_TAGS.gallery)
      purgeTags.add(CACHE_TAGS.sitemap)
      purgeTags.add(CACHE_TAGS.llms)
      for (const id of changedIds)
        purgeTags.add(streamTag(id))
      published += 1
    }

    if (datasetFailed)
      failures += 1
  }

  if (purgeTags.size > 0) {
    const result = await purgeCache({ tags: [...purgeTags] })
    if (result.skipped)
      console.log(`[update] 缓存失效跳过：${result.reason}`)
    else if (result.success)
      console.log(`[update] 缓存失效：${[...purgeTags].join(', ')}`)
    else {
      failures += 1
      console.warn(`[update] 缓存失效失败：${result.reason ?? `HTTP ${result.status ?? '?'}`}`)
    }
  }

  console.log(`\n[update] 完成：新场次 ${newTotal}，重抓 ${forcedTotal}，更新 ${published} 个成员，失败 ${failures} 个`)
  if (failures > 0)
    process.exitCode = 1
}

await main()
