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
 *   - 缺 VSTATS 的场次走 `backfill-vstats.ts`：只请求单场页，不重抓素材，也不受 14 天窗口限制。
 *   - `--force` 重抓最近 24 小时；平时会重试近期缺弹幕的场次，
 *     避免回放页面还没生成时被永久判死。缺 VSTATS 由单独的补抓步骤处理。
 *   - 发布顺序：抓取 → ingest → 资产 → 逐字稿 → purge；数据库提交成功后才失效缓存。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Option } from 'commander'
import { inArray } from 'drizzle-orm'
import { runBatch } from '@/db/batch.ts'
import { createDb, createWriteDb } from '@/db/connection.ts'
import { datasetInsights, streams } from '@/db/schema.ts'
import { CACHE_TAGS, datasetTag, streamTag } from '@/lib/cache-tags.ts'
import { type CommandSpec, type Logger, CliError, requireEnv } from '@chilfish/devkit/cli'
import { loadCollaborations } from '@scripts/lib/collaborations.ts'
import {
  planCollaborationUpdates,
  refreshCollaborationTotals,
  writeCollaborationChanges,
  type CollaborationRow,
} from '@scripts/lib/collaboration-sync.ts'
import { purgeCache } from '@scripts/lib/purge.ts'
import { syncScheduleFromChannel } from '@scripts/lib/schedule-sync.ts'
import { planDataset, type ChannelEntry, type PlanStream } from '@scripts/lib/update-plan.ts'
import { resolveCookies, ytdlpCookieArgs } from '@scripts/lib/yt-cookies.ts'
import { runFetch } from './fetch.ts'
import { runVstats } from './vstats.ts'
import { runThumbnails } from './thumbnails.ts'
import { runIngest } from '../db/ingest.ts'
import { runPublishData } from '../publish/data.ts'
import { runPublishTranscripts } from '../publish/transcripts.ts'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')

const FORCE_RECENT_HOURS = 24
const PACK_SUFFIX = '.datapack.json'

type Report = (level: 'info' | 'warn' | 'error', message: string) => void

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
  participants: string[] | null
}

interface LoadedDatabases {
  states: Map<string, LoadedState>
  /** 联动对账用的现状行；与上面的查询共用一次读取。 */
  collaborationRows: CollaborationRow[]
}

/** 已入库的场次与 insights 时间：数据库是「哪些场次已经有了」的唯一来源。 */
async function loadDatabaseStates(
  db: ReturnType<typeof createDb>,
  sources: DatasetSource[],
): Promise<LoadedDatabases> {
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
        participants: streams.participants,
      })
      .from(streams)
      .where(inArray(streams.datasetId, ids)),
    db
      .select({ datasetId: datasetInsights.datasetId, generatedAt: datasetInsights.generatedAt })
      .from(datasetInsights)
      .where(inArray(datasetInsights.datasetId, ids)),
  ])

  const byDataset = new Map<string, PlanStream[]>()
  const collaborationRows: CollaborationRow[] = []
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
    collaborationRows.push({
      videoId: row.videoId,
      datasetId: row.datasetId,
      title: row.title,
      participants: row.participants ?? [],
    })
  }

  const generatedAt = new Map(insights.map(row => [row.datasetId, isoOrNull(row.generatedAt)]))

  const states = new Map(sources.map(source => [source.id, {
    streams: byDataset.get(source.id) ?? [],
    generatedAt: generatedAt.get(source.id) ?? null,
    from: 'database' as const,
  }]))
  return { states, collaborationRows }
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
async function readChannelEntries(
  source: DatasetSource,
  stateDir: string,
  report: Report,
): Promise<ChannelList> {
  const cachePath = join(stateDir, `channel-${source.id}.json`)
  if (!source.channelId) {
    report('warn', `${source.id} 缺少 channelId，跳过频道列表`)
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
    report('warn', `${source.id} 频道列表为空`)
  }
  catch (error) {
    report('warn', `${source.id} 频道列表抓取失败：${describe(error)}`)
  }

  if (existsSync(cachePath)) {
    const cached = readChannelCache(cachePath)
    report('warn', `${source.id} 使用频道列表缓存（${cached.length} 条），本次可能漏掉新场次`)
    return { entries: cached, failed: true }
  }
  report('warn', `${source.id} 没有频道列表缓存，本次只能处理待补数据的场次`)
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

/** `data update` 的选项。 */
export interface UpdateOptions {
  dataset?: string
  root?: string
  stateDir?: string
  concurrency?: number
  cookies?: string
  cookiesFromBrowser?: string
  cookieCache?: string
  noCookies?: boolean
  vstatsLimit?: number
  noVstats?: boolean
  force?: boolean
  dryRun?: boolean
  noPublish?: boolean
  bootstrap?: boolean
  /** 运行期日志；CLI 传 ctx.log，测试可省略。 */
  log?: Logger
}

export interface UpdateResult {
  exitCode: number
  data?: Record<string, unknown>
}

/**
 * 每日增量：频道差集 → 定点抓取 → 补 VSTATS / 封面 → ingest → 发布 → purge。
 *
 * 本地和 GitHub Actions 共用同一个入口；安静日（无新场次且本地 pack 不比数据库新）
 * 不抓取、不 ingest、不发布。
 */
export async function runUpdate(options: UpdateOptions = {}): Promise<UpdateResult> {
  const report: Report = (level, message) => {
    if (options.log) options.log[level](message)
    else if (level === 'error') console.error(message)
    else if (level === 'warn') console.warn(message)
    else console.log(message)
  }
  // 兄弟命令收 Logger，CLI 传进来的就是；没有时给个只落 stderr 的占位实现。
  const fallbackLog: Logger = {
    name: 'data.update',
    info: (message: string) => report('info', message),
    warn: (message: string) => report('warn', message),
    error: (message: string) => report('error', message),
    debug: () => {},
    line: (message: string) => report('info', message),
    output: () => {},
    child: () => fallbackLog,
  }
  const log: Logger = options.log ?? fallbackLog

  const sources = readJson<{ datasets?: DatasetSource[] }>(CONFIG_PATH).datasets ?? []
  const selected = options.dataset ? sources.filter(item => item.id === options.dataset) : sources
  if (selected.length === 0) {
    report('error', `找不到 dataset：${options.dataset ?? '(data-sources.json 为空)'}`)
    report('error', `可用：${sources.map(item => item.id).join(', ') || '(空)'}`)
    return { exitCode: 1 }
  }

  const root = resolve(options.root ?? process.env.STREAM_SESSION_ROOT ?? join(APP_ROOT, 'temp', 'youtube-live'))
  const dataRoot = join(APP_ROOT, 'data')
  if (root === dataRoot || root.startsWith(`${dataRoot}${sep}`)) {
    report('error', '--root 是原始素材目录，不能指向 data/')
    return { exitCode: 1 }
  }
  const stateDir = resolve(options.stateDir ?? join(root, '.fetch-state'))
  mkdirSync(root, { recursive: true })
  mkdirSync(stateDir, { recursive: true })
  // 安静日不会走到 publish，但 CI 的 data/ 缓存需要一个真实存在的目录。
  mkdirSync(dataRoot, { recursive: true })

  const concurrency = options.concurrency ?? 3
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    report('error', '--concurrency 需要是 >= 1 的整数')
    return { exitCode: 1 }
  }
  // cookie 默认每次运行重新导出到 ~/yt-cookies.txt；CI 走显式 --cookies 文件。
  const cookiesFromBrowser = options.cookiesFromBrowser ?? 'firefox'
  const resolvedCookies = await resolveCookies({
    cookies: options.cookies,
    envCookie: process.env.YT_COOKIE,
    browser: cookiesFromBrowser,
    cachePath: options.cookieCache,
    disable: options.noCookies,
    appRoot: APP_ROOT,
    log: line => report('info', line),
  })
  const cookieArgs = ytdlpCookieArgs(resolvedCookies, { browser: cookiesFromBrowser })
  const dryRun = options.dryRun === true
  const noPublish = options.noPublish === true
  const vstatsLimit = options.vstatsLimit ?? 20
  if (!Number.isInteger(vstatsLimit) || vstatsLimit < 0) {
    report('error', '--vstats-limit 需要是 >= 0 的整数')
    return { exitCode: 1 }
  }
  const vstatsEnabled = !dryRun && !noPublish && !options.noVstats

  const databaseUrl = requireEnv('DATABASE_URL', '缺少环境变量 DATABASE_URL；请在 .dev.vars 中配置')
  const db = createDb(databaseUrl)
  const { states, collaborationRows } = await loadDatabaseStates(db, selected)
  const knownDatasetIds = sources.map(source => source.id)
  const collaborations = loadCollaborations({ knownDatasetIds })
  if (collaborations.skipped.length > 0) {
    report('warn', `联动登记跳过 ${collaborations.skipped.length} 条`)
    for (const skip of collaborations.skipped)
      report('warn', `  跳过 ${skip.videoId}/${skip.datasetId || '-'}：${skip.reason}`)
  }

  let failures = 0
  let newTotal = 0
  let forcedTotal = 0
  let published = 0
  let collaborationChanges = 0
  let transcriptsPublished = false
  const purgeTags = new Set<string>()

  for (const source of selected) {
    report('info', `=== ${source.label} (${source.id}) ===`)
    const state = states.get(source.id) ?? { streams: [], generatedAt: null, from: 'database' as const }
    const knownIds = state.streams.map(stream => stream.videoId)
    report('info', `数据库：${knownIds.length} 场（${state.from}）`)

    const channelList = await readChannelEntries(source, stateDir, report)
    const channel = channelList.entries
    if (channel.length === 0 && knownIds.length === 0) {
      report('warn', `${source.id} 既没有频道列表也没有已入库场次，跳过`)
      failures += 1
      continue
    }
    if (knownIds.length === 0 && channel.length > 20 && !options.bootstrap) {
      report('error', `${source.id} 数据库里还没有场次，但频道有 ${channel.length} 条；`)
      report('error', '拒绝把整个频道当成新场次。确认要首次建档时加 --bootstrap。')
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
          const normalized = schedule.normalized > 0 ? `，归一重复 ${schedule.normalized}` : ''
          const pruned = schedule.pruned > 0 ? `，清理过期 ${schedule.pruned}` : ''
          report('info', `${source.id} 日程：预定 ${schedule.upserted}，直播中 ${schedule.live}${normalized}${pruned}`)
        }
      }
      catch (error) {
        failures += 1
        report('warn', `${source.id} 日程同步失败：${describe(error)}`)
      }
    }

    const plan = planDataset({
      channel,
      knownIds,
      streams: state.streams,
      forceRecentHours: options.force ? FORCE_RECENT_HOURS : 0,
    })

    report('info', `计划：新场次 ${plan.newIds.length}，重抓 ${plan.forceIds.length}，暂缓 ${plan.deferredIds.length}`)
    if (plan.newIds.length > 0)
      report('info', `  新：${plan.newIds.slice(0, 10).join(', ')}${plan.newIds.length > 10 ? ` 等 ${plan.newIds.length} 场` : ''}`)
    if (plan.forceIds.length > 0) {
      const detail = plan.forceIds.slice(0, 10).map(id => `${id}(${plan.reasons.get(id) ?? '重抓'})`).join(', ')
      report('info', `  重抓：${detail}${plan.forceIds.length > 10 ? ` 等 ${plan.forceIds.length} 场` : ''}`)
    }
    if (plan.expiredIds.length > 0) {
      const detail = plan.expiredIds.slice(0, 10).map(id => `${id}(${plan.reasons.get(id) ?? '已过期'})`).join(', ')
      report('info', `  已放弃：${detail}${plan.expiredIds.length > 10 ? ` 等 ${plan.expiredIds.length} 场` : ''}`)
    }

    // 上次抓取成功但 ingest 失败（或本地用了 --no-publish）时，本地 pack 会比数据库新；
    // 这种日子没有新场次也要补一次 ingest，否则改动会一直卡在本地。
    const local = localPackState(source)
    const localAhead = local.count > state.streams.length
      || (state.generatedAt == null
        ? local.count > 0
        : local.newest != null && local.newest > Date.parse(state.generatedAt))
    if (localAhead)
      report('info', '本地 pack 还没入库，本次补 ingest')

    const hasFetchWork = plan.newIds.length > 0 || plan.forceIds.length > 0
    if (!hasFetchWork && !localAhead && !vstatsEnabled) {
      if (channelList.failed) {
        report('warn', `${source.id} 没有可处理的变化，但频道列表不可用；记一次失败`)
        failures += 1
      }
      else {
        report('info', `${source.id} 没有变化，跳过`)
      }
      continue
    }
    if (dryRun) {
      report('info', `${source.id} dry-run，不抓取也不发布`)
      continue
    }

    newTotal += plan.newIds.length
    forcedTotal += plan.forceIds.length

    // 频道列表失败时本次可能漏掉新场次；继续处理待补数据的场次，但结果记为失败。
    let datasetFailed = channelList.failed

    // 正常增量：只把这次判定要抓的场次交给 fetch，未来场/摘要不会被重新拉一遍元信息。
    if (plan.newIds.length > 0) {
      const idsFile = join(stateDir, `daily-ids-${source.id}.txt`)
      writeFileSync(idsFile, `${plan.newIds.join('\n')}\n`, 'utf8')
      report('info', `${source.id} 抓取新场次…`)
      const fetched = await runFetch({
        dataset: source.id,
        root,
        ids: idsFile,
        restore: true,
        noPublish: true,
        concurrency: String(concurrency),
        cookies: options.cookies,
        cookiesFromBrowser: cookiesFromBrowser,
        cookieCache: options.cookieCache,
        noCookies: options.noCookies,
        log,
      })
      if (fetched.exitCode !== 0) {
        datasetFailed = true
        report('warn', `${source.id} 新场次抓取有失败项（exit ${fetched.exitCode}）`)
      }
    }

    // 定点重抓：最近 24 小时 + 缺弹幕；VSTATS 由下面的补抓步骤单独处理。
    if (plan.forceIds.length > 0) {
      report('info', `${source.id} 重抓 ${plan.forceIds.length} 场…`)
      const fetched = await runFetch({
        dataset: source.id,
        root,
        force: plan.forceIds,
        restore: true,
        noPublish: true,
        concurrency: String(concurrency),
        cookies: options.cookies,
        cookiesFromBrowser: cookiesFromBrowser,
        cookieCache: options.cookieCache,
        noCookies: options.noCookies,
        log,
      })
      if (fetched.exitCode !== 0) {
        datasetFailed = true
        report('warn', `${source.id} 重抓有失败项（exit ${fetched.exitCode}）`)
      }
    }

    // VSTATS 只请求单场页；不受 14 天窗口限制，按每轮配额轮转补齐。
    let vstatsIds: string[] = []
    if (vstatsEnabled) {
      const idsOut = join(stateDir, `vstats-updated-${source.id}.txt`)
      writeFileSync(idsOut, '', 'utf8')
      report('info', `${source.id} 补抓 VSTATS…`)
      const stats = await runVstats({
        dataset: source.id,
        limit: vstatsLimit,
        idsOut,
        quiet: true,
        log,
      })
      if (stats.exitCode !== 0) {
        datasetFailed = true
        report('warn', `${source.id} VSTATS 补抓有失败项（exit ${stats.exitCode}）`)
      }
      else if (existsSync(idsOut)) {
        vstatsIds = readFileSync(idsOut, 'utf8')
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean)
      }
      if (vstatsIds.length > 0)
        report('info', `${source.id} 补到 VSTATS ${vstatsIds.length} 场`)
    }

    if (noPublish) {
      report('info', `${source.id} --no-publish，跳过封面与发布`)
      continue
    }

    if (!hasFetchWork && !localAhead && vstatsIds.length === 0) {
      if (channelList.failed) {
        report('warn', `${source.id} 没有可处理的变化，但频道列表不可用；记一次失败`)
        failures += 1
      }
      else {
        report('info', `${source.id} 没有变化，跳过`)
      }
      continue
    }

    // 只补发布时没有新场次，不需要碰封面（空 --ids 不能当成“全部”）。
    const thumbIds = unique([...plan.newIds, ...plan.forceIds])
    if (thumbIds.length > 0) {
      const thumbFile = join(stateDir, `daily-thumbs-${source.id}.txt`)
      writeFileSync(thumbFile, `${thumbIds.join('\n')}\n`, 'utf8')
      const thumbs = await runThumbnails({
        dataset: source.id,
        ids: thumbFile,
        log,
      })
      if (thumbs.exitCode !== 0) {
        datasetFailed = true
        report('warn', `${source.id} 封面补抓有失败项（exit ${thumbs.exitCode}）`)
      }
    }

    // 本次真正会变动的 ID：新场 / 重抓场 / 补到 VSTATS 的场；都没有时退回最近 7 天改过的 pack。
    // 把它传给 ingest / publish，避免每次都扫全量 pack、查全量 hash。
    const changedIds = unique([...thumbIds, ...vstatsIds])
    if (changedIds.length === 0)
      changedIds.push(...recentPackIds(source))
    const changedFile = changedIds.length > 0
      ? join(stateDir, `daily-changed-${source.id}.txt`)
      : null
    if (changedFile)
      writeFileSync(changedFile, `${changedIds.join('\n')}\n`, 'utf8')

    // 逐字稿先上传正文，随后 ingest 才会把新稿的元数据同步进数据库。
    if (!transcriptsPublished) {
      report('info', '发布逐字稿…')
      const transcripts = await runPublishTranscripts({
        noUpload: false,
        force: false,
        log,
      })
      if (transcripts.exitCode !== 0) {
        datasetFailed = true
        report('warn', `逐字稿发布有失败项（exit ${transcripts.exitCode}）`)
      }
      else {
        transcriptsPublished = true
        purgeTags.add(CACHE_TAGS.transcripts)
      }
    }

    report('info', `${source.id} 写入数据库…`)
    const ingest = await runIngest([
      '--dataset', source.id,
      ...(changedFile ? ['--ids', changedFile] : []),
    ])
    const ingestOk = ingest.exitCode === 0
    if (!ingestOk) {
      datasetFailed = true
      report('warn', `${source.id} ingest 失败（exit ${ingest.exitCode}）`)
    }

    report('info', `${source.id} 发布资产…`)
    const publish = await runPublishData({
      dataset: source.id,
      assetsOnly: true,
      ids: changedFile ?? undefined,
      log,
    })
    if (publish.exitCode !== 0) {
      datasetFailed = true
      report('warn', `${source.id} 资产发布失败（exit ${publish.exitCode}）`)
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

  // 联动参与者对账：手动登记优先（含显式空数组），没登记的场次按标题推断。
  // 放在成员循环之后：安静日也要跑，手动补登 / 删登才会落到已入库场次上。
  {
    const diff = planCollaborationUpdates({
      rows: collaborationRows,
      manual: collaborations.byVideo,
      knownDatasetIds,
      // 只跑单个成员时，其他成员的登记不在本次 rows 里，不该报缺失。
      reportMissing: !options.dataset,
    })
    for (const conflict of diff.conflicts)
      report('warn', `联动登记 ${conflict.videoId} 把频道主 ${conflict.ownerId} 写成了参与者，已跳过`)
    for (const videoId of diff.missing)
      report('warn', `联动登记里的 ${videoId} 库里没有；补 pack 后下一轮自动生效`)
    if (diff.changes.length > 0) {
      for (const change of diff.changes.slice(0, 10)) {
        const source = change.source === 'title' ? '，标题推断' : ''
        report('info', `联动 ${change.videoId}（${change.ownerId}）：[${change.before.join(', ')}] → [${change.after.join(', ')}${source}]`)
      }
      if (diff.changes.length > 10)
        report('info', `   …其余 ${diff.changes.length - 10} 场略`)
      if (!dryRun && !noPublish) {
        const { db: writeDb, pool } = createWriteDb(databaseUrl)
        try {
          await writeCollaborationChanges(writeDb, diff.changes)
          const totals = await refreshCollaborationTotals(db, writeDb, diff.affectedDatasetIds)
          for (const datasetId of totals.missing)
            report('warn', `public_totals 缺少 ${datasetId} 的 insights 行；先跑 db ingest`)
          collaborationChanges = diff.changes.length
          for (const change of diff.changes) {
            purgeTags.add(streamTag(change.videoId))
            purgeTags.add(datasetTag(change.ownerId))
          }
          for (const datasetId of diff.affectedDatasetIds)
            purgeTags.add(datasetTag(datasetId))
          purgeTags.add(CACHE_TAGS.group)
          purgeTags.add(CACHE_TAGS.datasets)
          purgeTags.add(CACHE_TAGS.gallery)
        }
        catch (error) {
          failures += 1
          report('warn', `联动参与者写入失败：${describe(error)}`)
        }
        finally {
          await pool.end()
        }
      }
    }
  }

  if (purgeTags.size > 0) {
    const result = await purgeCache({ tags: [...purgeTags] })
    if (result.skipped)
      report('info', `缓存失效跳过：${result.reason}`)
    else if (result.success)
      report('info', `缓存失效：${[...purgeTags].join(', ')}`)
    else {
      failures += 1
      report('warn', `缓存失效失败：${result.reason ?? `HTTP ${result.status ?? '?'}`}`)
    }
  }

  const summary = { newStreams: newTotal, refetched: forcedTotal, collaborations: collaborationChanges, published, failures }
  report('info', `完成：新场次 ${newTotal}，重抓 ${forcedTotal}，联动 ${collaborationChanges} 场，更新 ${published} 个成员，失败 ${failures} 个`)
  return { exitCode: failures > 0 ? 1 : 0, data: summary }
}

/** 每日增量更新：本地与 GitHub Actions 共用。 */
export const dataUpdateSpec: CommandSpec = {
  id: 'data.update',
  description: '每日增量：频道差集 → 定点抓取 → 补 VSTATS / 封面 → ingest → 发布 → purge',
  details: '本地和 GitHub Actions 共用。安静日（无新场次且本地 pack 不比数据库新）不抓取、不发布。',
  examples: [
    'bun run ymmt data update',
    'bun run ymmt data update --force',
    'bun run ymmt data update --dataset nonoka --dry-run',
    'bun run ymmt data update --no-publish',
  ],
  options: [
    new Option('--dataset <id>', '只处理一个成员；默认全部'),
    new Option('--root <目录>', '原始会话目录，默认 $STREAM_SESSION_ROOT 或 ./temp/youtube-live'),
    new Option('--state-dir <目录>', '进度 / 频道缓存，默认 <root>/.fetch-state'),
    new Option('--concurrency <n>', '抓取并发，默认 3'),
    new Option('--cookies <文件>', 'Netscape cookie jar；CI 用这个'),
    new Option('--cookies-from-browser <b>', '导出 cookie 的浏览器，默认 firefox'),
    new Option('--cookie-cache <文件>', 'cookie 缓存路径，默认 ~/yt-cookies.txt'),
    new Option('--no-cookies', '匿名抓取'),
    new Option('--vstats-limit <n>', '每个成员本轮最多补 n 场 VSTATS，默认 20'),
    new Option('--no-vstats', '跳过 VSTATS 补抓'),
    new Option('--force', '额外重抓最近 24 小时结束的场次'),
    new Option('--no-publish', '只写本地，不写库、不上传'),
    new Option('--bootstrap', '数据库为空时也允许按全量新场次处理'),
  ],
  async run(ctx) {
    const dataset = typeof ctx.options.dataset === 'string' ? ctx.options.dataset : undefined
    if (!dataset && sourcesHaveNoDatasets()) {
      throw new CliError('data-sources.json 里没有 datasets', {
        code: 'EMPTY_CONFIG',
        hint: '检查 data-sources.json 的 datasets 数组',
      })
    }
    const result = await runUpdate({
      dataset,
      root: typeof ctx.options.root === 'string' ? ctx.options.root : undefined,
      stateDir: typeof ctx.options.stateDir === 'string' ? ctx.options.stateDir : undefined,
      concurrency: ctx.integer('concurrency', 3, 1),
      cookies: typeof ctx.options.cookies === 'string' ? ctx.options.cookies : undefined,
      cookiesFromBrowser: typeof ctx.options.cookiesFromBrowser === 'string'
        ? ctx.options.cookiesFromBrowser
        : 'firefox',
      cookieCache: typeof ctx.options.cookieCache === 'string' ? ctx.options.cookieCache : undefined,
      noCookies: ctx.flag('noCookies'),
      vstatsLimit: ctx.integer('vstatsLimit', 20, 0),
      noVstats: ctx.flag('noVstats'),
      force: ctx.flag('force'),
      dryRun: ctx.dryRun,
      noPublish: ctx.flag('noPublish'),
      bootstrap: ctx.flag('bootstrap'),
      log: ctx.log,
    })
    return { exitCode: result.exitCode, data: result.data }
  },
}

/** data-sources.json 是否为空；只有真正空配置才提前报错。 */
function sourcesHaveNoDatasets(): boolean {
  const sources = readJson<{ datasets?: DatasetSource[] }>(CONFIG_PATH).datasets ?? []
  return sources.length === 0
}
