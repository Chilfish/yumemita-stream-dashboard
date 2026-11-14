/**
 * 开播前 / 直播中的弹幕采集（InnerTube live chat）。
 *
 *   bun run ymmt data live-chat --video fmjJNbzcr3g
 *   bun run ymmt data live-chat --dataset yuno --ids ids.txt --once
 *
 * yt-dlp 的 `live_chat` 字幕只在直播结束后才有，等待室与直播中的弹幕它拿不到。
 * 本命令从 watch 页取 `liveChatRenderer` 的 continuation（等待室只有 reload），
 * 轮询 `youtubei/v1/live_chat/get_live_chat`，按与回放完全相同的口径归一化：
 * text / SC / 贴纸 / 会员 / 赠送会员 / 领取赠礼、徽章、authorId、频道表情、主播发言。
 *
 * 输出（与 `data fetch` / `data danmaku` 共用会话目录）：
 *   danmaku/danmaku_live_<videoId>.jsonl   实时采集，记录带 `rendererId` 供合并去重
 *   danmaku/emoji_<videoId>.json           本场出现过的频道表情
 *   work/live-chat-state.json              continuation / 计数 / 停止原因，可续跑
 *
 * 直播结束后再加 `--video` 运行一次会自动改走 InnerTube 回放
 * （`scripts/lib/live-chat-collect.ts`）：写 `danmaku_<videoId>.jsonl`、
 * `events_<videoId>.jsonl` 与 `emoji_<videoId>.json`，并合并已有的实时采集。
 * 加 `--once` 时只取一页，不会触发完整回放。
 *
 * 注意：默认跟随到直播结束（Ctrl-C 可随时停，状态会保存）。加 `--once` 只拉一页，
 * 适合定时任务或开播前先把等待室历史落盘。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { Option } from 'commander'
import type { Logger } from '@scripts/lib/cli/logger.ts'
import type { CommandSpec } from '@scripts/lib/cli/runtime.ts'
import { CliError, UsageError } from '@scripts/lib/cli/exit.ts'
import { danmakuKey, loadDanmakuFile, writeDanmakuFile } from '@scripts/lib/danmaku-merge.ts'
import { collectReplay, chatHeaders, datasetForVideo } from '@scripts/lib/live-chat-collect.ts'
import { resolveCookies } from '@scripts/lib/yt-cookies.ts'
import {
  classifyChatError,
  classifyWatchStatus,
  extractChatItems,
  extractPollContinuation,
  extractWatchPage,
  hasApiError,
  LIVE_CHAT_API_URL,
  INNERTUBE_CONTEXT,
  pollDelayMs,
  WATCH_URL,
  type WatchDisposition,
  type WatchPage,
  type WatchStatus,
} from '@scripts/lib/innertube-live.ts'
import { writeEmojiSidecar, type ChatEmoji, type ChatRecord } from '@scripts/lib/live-chat.ts'
import { chatEventKey, extractChatEvents, type ChatEventRecord } from '@scripts/lib/live-chat-events.ts'

const APP_ROOT = resolve(import.meta.dir, '../../..')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')
const STATE_VERSION = 1
const DEFAULT_MIN_INTERVAL_MS = 1000
const DEFAULT_MAX_INTERVAL_MS = 15_000
const DEFAULT_PAGE_DELAY_MS = 150
const DEFAULT_COOKIE_BROWSER = 'firefox'

interface DatasetSource {
  id: string
  label: string
  channelId?: string
}

interface CollectorState {
  version: number
  videoId: string
  datasetId: string | null
  label: string | null
  session: string
  startedAt: string
  updatedAt: string
  continuation: string | null
  continuationKind: string | null
  lastSeq: number
  stored: number
  eventsStored: number
  duplicates: number
  polls: number
  disposition: WatchDisposition
  status: WatchStatus | null
  lastError: string | null
  stopReason: string | null
}

/** 注入的日志器；默认静默，方便测试与进程内调用。 */
export type CommandLog = Pick<Logger, 'info' | 'warn' | 'error'>

const SILENT_LOG: CommandLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

export interface CollectVideoSummary {
  videoId: string
  label: string
  session: string | null
  stopReason: string | null
  stored: number
  events: number
  duplicates: number
  polls: number
  error: string | null
}

export interface RunLiveChatOptions {
  /** 单个视频 ID。 */
  video?: string
  /** 视频 ID 列表文件（每行一个）。 */
  ids?: string
  /** 强制指定 dataset；默认按 watch 页的 channelId 匹配。 */
  dataset?: string
  /** 会话根目录（默认 $STREAM_SESSION_ROOT 或 ./temp/youtube-live）。 */
  root?: string
  /** Cookie 请求头（会员限定需要）；也可用环境变量 YT_COOKIE。 */
  cookie?: string
  /** Netscape cookie jar（yt-dlp 导出的 cookies.txt）。 */
  cookies?: string
  /** 最长跟随小时数，0 = 不限（默认 0）。 */
  maxHours?: number
  /** 轮询间隔下限，默认 1000。 */
  minInterval?: number
  /** 轮询间隔上限，默认 15000。 */
  maxInterval?: number
  /** 回放每页间隔，默认 150。 */
  pageDelay?: number
  /** 回放最多翻多少页，0 = 不限。 */
  maxPages?: number
  /** 只取一页（等待室历史 / 定时任务），不触发完整回放。 */
  once?: boolean
  /** 已结束时只报告，不自动抓回放。 */
  noReplay?: boolean
  /** 导出 cookie 时用哪个浏览器，默认 firefox。 */
  cookiesFromBrowser?: string
  /** cookie 缓存路径，默认 ~/yt-cookies.txt。 */
  cookieCache?: string
  /** 不使用 cookie，以匿名状态抓取。 */
  noCookies?: boolean
  /** 只打印统计，不写文件。 */
  dryRun?: boolean
  /** 注入的日志器；默认静默。 */
  log?: CommandLog
}

export interface LiveChatRunResult {
  videos: CollectVideoSummary[]
  failures: number
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

function jstDate(seconds: number | null): string {
  if (seconds == null)
    return '0000-00-00'
  return new Date((seconds + 540 * 60) * 1000).toISOString().slice(0, 10)
}

function videoIdOf(raw: string): string | null {
  const trimmed = raw.trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed))
    return trimmed
  const match = /(?:v=|youtu\.be\/|\/live\/)([A-Za-z0-9_-]{11})/.exec(trimmed)
  return match?.[1] ?? null
}

class ChatHttpError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message)
  }
}

async function fetchWatchPage(videoId: string, headers: Record<string, string>): Promise<string> {
  const response = await fetch(WATCH_URL(videoId), { headers })
  if (!response.ok)
    throw new ChatHttpError(`watch_page_http_${response.status}`, response.status, '')
  return await response.text()
}

async function pollChat(continuation: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(LIVE_CHAT_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ context: INNERTUBE_CONTEXT, continuation }),
  })
  const body = await response.text()
  if (!response.ok)
    throw new ChatHttpError(`live_chat_http_${response.status}`, response.status, body)
  try {
    return JSON.parse(body) as unknown
  }
  catch (error) {
    throw new Error(`live_chat_bad_json: ${describe(error)}`)
  }
}

function saveState(path: string, state: CollectorState): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
}

function loadState(path: string, videoId: string): CollectorState | null {
  if (!existsSync(path))
    return null
  try {
    const state = readJson<CollectorState>(path)
    return state.videoId === videoId ? state : null
  }
  catch {
    return null
  }
}

function existingSession(root: string, videoId: string): string | null {
  if (!existsSync(root))
    return null
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.'))
      continue
    if (entry.name.endsWith(`_${videoId}`))
      return join(root, entry.name)
  }
  return null
}

function readEmojiSidecar(path: string): Map<string, ChatEmoji> {
  const emojis = new Map<string, ChatEmoji>()
  if (!existsSync(path))
    return emojis
  try {
    const payload = readJson<{ emojis?: ChatEmoji[] }>(path)
    for (const emoji of payload.emojis ?? []) {
      if (emoji?.id && emoji.url)
        emojis.set(emoji.id, emoji)
    }
  }
  catch {
    // 坏档就重新生成
  }
  return emojis
}

interface ResolvedDataset {
  dataset: DatasetSource | null
  label: string
}

function resolveDataset(
  sources: DatasetSource[],
  channelId: string | null,
  explicitId: string | undefined,
): ResolvedDataset {
  if (explicitId) {
    const dataset = sources.find(source => source.id === explicitId) ?? null
    return { dataset, label: dataset?.label ?? explicitId }
  }
  const dataset = channelId
    ? sources.find(source => source.channelId === channelId) ?? null
    : null
  return { dataset, label: dataset?.label ?? 'unknown' }
}

interface CollectOptions {
  root: string
  cookie: string | null
  minInterval: number
  maxInterval: number
  once: boolean
  dryRun: boolean
  maxHours: number
  datasetId: string | undefined
  /** 已结束时自动抓完整回放；`--once` / `--no-replay` 关闭。 */
  replay: boolean
  pageDelayMs: number
  maxPages: number
  log: CommandLog
}

/** 每次运行重新导出到 `~/yt-cookies.txt`，导出失败才用旧缓存。 */
async function resolveChatCookie(
  videoId: string,
  cli: {
    cookie?: string
    cookies?: string
    browser?: string
    cachePath?: string
    disable?: boolean
  },
  log: CommandLog,
): Promise<string | null> {
  const resolved = await resolveCookies({
    cookie: cli.cookie,
    cookies: cli.cookies,
    envCookie: process.env.YT_COOKIE,
    browser: cli.browser,
    cachePath: cli.cachePath,
    disable: cli.disable,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    appRoot: APP_ROOT,
    log: line => log.info(line),
  })
  if (resolved.source === 'cache' && resolved.jarPath)
    log.info(`cookie：复用缓存 ${resolved.jarPath}`)
  else if (resolved.source === 'none' && resolved.note)
    log.info(resolved.note)
  return resolved.header
}

async function collectVideo(
  videoId: string,
  options: CollectOptions,
  sources: DatasetSource[],
): Promise<CollectVideoSummary> {
  const log = options.log
  const summary: CollectVideoSummary = {
    videoId,
    label: 'unknown',
    session: null,
    stopReason: null,
    stored: 0,
    events: 0,
    duplicates: 0,
    polls: 0,
    error: null,
  }
  const headers = chatHeaders(options.cookie)

  let watch: WatchPage | null = null
  let watchError: string | null = null
  try {
    watch = extractWatchPage(await fetchWatchPage(videoId, headers))
  }
  catch (error) {
    watchError = describe(error)
  }

  let resolved = resolveDataset(sources, watch?.channelId ?? null, options.datasetId)
  if (!resolved.dataset && !options.datasetId) {
    // 已结束 / 受限场次的 watch 页可能没有 videoDetails；用本地 pack 反查成员。
    const guess = datasetForVideo(APP_ROOT, videoId)
    if (guess) {
      resolved = {
        dataset: sources.find(source => source.id === guess.id) ?? null,
        label: guess.label,
      }
    }
  }
  summary.label = resolved.label
  if (options.datasetId && !resolved.dataset) {
    log.error(`data-sources.json 里没有 dataset：${options.datasetId}`)
    summary.error = `data-sources.json 里没有 dataset：${options.datasetId}`
    summary.stopReason = 'unknown_dataset'
    return summary
  }

  const date = jstDate(watch?.scheduledStart ?? null)
  const session = existingSession(options.root, videoId)
    ?? join(options.root, `${date}_${resolved.label}_${videoId}`)
  summary.session = session
  const danmakuDir = join(session, 'danmaku')
  const livePath = join(danmakuDir, `danmaku_live_${videoId}.jsonl`)
  const eventsPath = join(danmakuDir, `events_${videoId}.jsonl`)
  const emojiPath = join(danmakuDir, `emoji_${videoId}.json`)
  const statePath = join(session, 'work', 'live-chat-state.json')
  const prior = loadState(statePath, videoId)

  if (!options.dryRun) {
    mkdirSync(danmakuDir, { recursive: true })
    mkdirSync(join(session, 'work'), { recursive: true })
  }

  const loaded = loadDanmakuFile(livePath)
  const seen = new Set(loaded.records.map(record => danmakuKey(record)))
  let seq = loaded.records.reduce(
    (max, record) => Math.max(max, typeof record.seq === 'number' ? record.seq : 0),
    0,
  )
  const loadedEvents = loadDanmakuFile(eventsPath)
  const seenEvents = new Set(loadedEvents.records.map(record => chatEventKey(record as unknown as ChatEventRecord)))
  let eventSeq = loadedEvents.records.reduce(
    (max, record) => Math.max(max, typeof record.seq === 'number' ? record.seq : 0),
    0,
  )
  let duplicates = prior?.duplicates ?? 0
  // rendererId → 作者/是否主播：删除事件要能对回被删消息，主播消息被删时仍能识别。
  const recordIndex = new Map<string, { author?: string, authorId?: string, owner: boolean, kind?: string, text?: string }>()
  const authorIndex = new Map<string, { name?: string, owner: boolean }>()
  const indexRecord = (record: ChatRecord): void => {
    if (record.rendererId) {
      recordIndex.set(record.rendererId, {
        author: record.msg.author,
        authorId: record.msg.authorId,
        owner: (record.msg.badges ?? []).includes('Owner'),
        kind: record.msg.kind,
        text: record.msg.text,
      })
    }
    if (record.msg.authorId) {
      const known = authorIndex.get(record.msg.authorId)
      authorIndex.set(record.msg.authorId, {
        name: record.msg.author ?? known?.name,
        owner: known?.owner === true || (record.msg.badges ?? []).includes('Owner'),
      })
    }
  }
  for (const record of loaded.records)
    indexRecord(record as unknown as ChatRecord)

  /** 删除事件对回被删消息：补作者、kind 与是否主播；被删正文留在 data 里。 */
  const decorateEvent = (event: ChatEventRecord): void => {
    if (event.type === 'deleted' && event.data?.targetItemId) {
      const target = recordIndex.get(String(event.data.targetItemId))
      if (!target)
        return
      event.author = target.author
      event.authorId = target.authorId
      event.owner = target.owner
      event.data = {
        ...event.data,
        targetAuthor: target.author ?? null,
        targetAuthorId: target.authorId ?? null,
        targetKind: target.kind ?? null,
        targetText: target.text ?? null,
        targetOwner: target.owner,
      }
      return
    }
    if (event.type === 'deletedAuthor' && event.data?.authorId) {
      const author = authorIndex.get(String(event.data.authorId))
      if (!author)
        return
      event.author = author.name
      event.owner = author.owner
      event.data = { ...event.data, targetAuthor: author.name ?? null, targetOwner: author.owner }
    }
  }
  if (loaded.invalid > 0 && !options.dryRun) {
    writeDanmakuFile(livePath, loaded.records)
    log.info(`${videoId} 清理 ${loaded.invalid} 行损坏记录`)
  }
  if (loadedEvents.invalid > 0 && !options.dryRun) {
    writeDanmakuFile(eventsPath, loadedEvents.records)
    log.info(`${videoId} 清理 ${loadedEvents.invalid} 行损坏事件`)
  }
  const emojis = readEmojiSidecar(emojiPath)

  let status = watch?.status ?? prior?.status ?? null
  let disposition: WatchDisposition = status ? classifyWatchStatus(status) : 'pending'
  let continuation = watch?.continuation?.token ?? (watchError ? prior?.continuation ?? null : null)
  let continuationKind = watch?.continuation?.kind ?? null
  let lastError: string | null = watchError

  const state: CollectorState = {
    version: STATE_VERSION,
    videoId,
    datasetId: resolved.dataset?.id ?? null,
    label: resolved.label,
    session,
    startedAt: prior?.startedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    continuation,
    continuationKind,
    lastSeq: seq,
    stored: seen.size,
    eventsStored: seenEvents.size,
    duplicates,
    polls: prior?.polls ?? 0,
    disposition,
    status,
    lastError,
    stopReason: null,
  }
  const persist = (): void => {
    state.updatedAt = new Date().toISOString()
    state.continuation = continuation
    state.continuationKind = continuationKind
    state.lastSeq = seq
    state.stored = seen.size
    state.eventsStored = seenEvents.size
    state.duplicates = duplicates
    state.disposition = disposition
    state.status = status
    state.lastError = lastError
    if (!options.dryRun)
      saveState(statePath, state)
  }

  log.info(`${videoId} ${resolved.label} 会话 ${session.split(/[\\/]/).at(-1)}`)
  if (watch?.title)
    log.info(`${videoId} 标题：${watch.title}`)
  if (status) {
    log.info(`${videoId} 状态：${disposition}${status.isReplay ? '（已是回放）' : ''}${status.availability === 'subscriber_only' ? '（会员限定）' : ''}`)
  }

  if (disposition === 'ended') {
    if (options.replay && !options.once) {
      log.info(`${videoId} 直播已结束，改走 InnerTube 回放`)
      state.stopReason = 'replay'
      persist()
      const replay = await collectReplay({
        videoId,
        session,
        cookie: options.cookie,
        pageDelayMs: options.pageDelayMs,
        maxPages: options.maxPages,
        dryRun: options.dryRun,
        log: line => log.info(line),
      })
      state.stopReason = replay.status === 'done' ? 'replay' : `replay:${replay.status}`
      state.lastError = replay.error ?? null
      state.stored = replay.total
      state.eventsStored = replay.events
      state.duplicates = replay.duplicates
      persist()
      summary.stopReason = state.stopReason
      summary.stored = replay.total
      summary.events = replay.events
      summary.duplicates = replay.duplicates
      summary.polls = state.polls
      if (replay.status === 'done') {
        log.info(`${videoId} 回放完成：${replay.total} 条消息、${replay.events} 个事件、${replay.emojis} 个表情 → ${replay.output}`)
      }
      else if (replay.reason === 'chat-replay-unavailable') {
        log.info(`${videoId} 平台未保留这场回放，没有可采集的弹幕`)
      }
      else {
        log.info(`${videoId} 回放未完成（${replay.status}）${replay.error ? `：${replay.error}` : ''}；重跑会从断点续翻`)
      }
      return summary
    }
    log.info(`${videoId} 直播已结束，实时采集跳过${options.once ? '（--once 不抓回放；去掉 --once 或先跑 fetch:danmaku）' : '（--no-replay）'}`)
    state.stopReason = 'ended'
    persist()
    summary.stopReason = state.stopReason
    summary.stored = seen.size
    summary.events = seenEvents.size
    summary.duplicates = duplicates
    summary.polls = state.polls
    return summary
  }
  if (disposition === 'chat_disabled') {
    log.info(`${videoId} 聊天已被禁用，无法采集`)
    state.stopReason = 'chat_disabled'
    persist()
    summary.stopReason = state.stopReason
    summary.stored = seen.size
    summary.events = seenEvents.size
    summary.duplicates = duplicates
    summary.polls = state.polls
    return summary
  }
  if (disposition === 'unplayable' && !continuation) {
    log.info(`${videoId} 播放器受限且没有弹幕 token（会员限定 / 需要登录 cookie）`)
    state.stopReason = 'unplayable'
    persist()
    summary.stopReason = state.stopReason
    summary.stored = seen.size
    summary.events = seenEvents.size
    summary.duplicates = duplicates
    summary.polls = state.polls
    return summary
  }
  if (!continuation && watchError) {
    log.info(`${videoId} 取不到 continuation：${watchError}`)
    state.stopReason = 'no_continuation'
    persist()
    summary.stopReason = state.stopReason
    summary.error = watchError
    summary.stored = seen.size
    summary.events = seenEvents.size
    summary.duplicates = duplicates
    summary.polls = state.polls
    return summary
  }

  let running = true
  const onSignal = (): void => {
    running = false
    log.info(`${videoId} 收到中断，保存状态后退出`)
  }
  process.once('SIGINT', onSignal)

  let stopReason: string | null = null
  let backoff = 2000
  const startedMs = Date.now()
  let lastStatusCheck = Date.now()

  while (running) {
    if (options.maxHours > 0 && Date.now() - startedMs >= options.maxHours * 3600_000) {
      stopReason = 'max_hours'
      break
    }

    // 等待室的 timed 链在直播结束后仍可能继续给空页；定期重看 watch 页确认终态。
    if (Date.now() - lastStatusCheck >= 10 * 60_000) {
      lastStatusCheck = Date.now()
      try {
        const page = extractWatchPage(await fetchWatchPage(videoId, headers))
        status = page.status
        const nextDisposition = classifyWatchStatus(status)
        if (nextDisposition !== disposition)
          log.info(`${videoId} 状态变化：${disposition} → ${nextDisposition}`)
        disposition = nextDisposition
        if (disposition === 'ended' || disposition === 'chat_disabled') {
          stopReason = disposition
          persist()
          break
        }
      }
      catch (error) {
        lastError = describe(error)
        log.info(`${videoId} 定期检查 watch 页失败：${lastError}`)
      }
      persist()
    }

    if (!continuation) {
      if (disposition === 'ended' || disposition === 'chat_disabled') {
        stopReason = disposition
        break
      }
      await sleep(Math.min(backoff, 60_000))
      if (!running)
        break
      backoff = Math.min(backoff * 2, 60_000)
      try {
        watch = extractWatchPage(await fetchWatchPage(videoId, headers))
        status = watch.status
        disposition = classifyWatchStatus(status)
        continuation = watch.continuation?.token ?? null
        continuationKind = watch.continuation?.kind ?? null
        lastError = null
        log.info(`${videoId} 重新取 token：${disposition} ${continuation ? `(${continuationKind})` : '（无）'}`)
        if (!continuation && (disposition === 'ended' || disposition === 'chat_disabled' || disposition === 'unplayable')) {
          stopReason = disposition
          break
        }
      }
      catch (error) {
        lastError = describe(error)
        log.info(`${videoId} watch 页失败：${lastError}`)
      }
      persist()
      continue
    }

    let payload: unknown
    try {
      payload = await pollChat(continuation, headers)
      backoff = 2000
    }
    catch (error) {
      const message = describe(error)
      const httpStatus = error instanceof ChatHttpError ? error.status : undefined
      const body = error instanceof ChatHttpError ? error.body : ''
      const kind = classifyChatError(`${message} ${body}`, httpStatus)
      lastError = message
      log.info(`${videoId} 轮询失败（${kind}）：${message}`)
      if (kind === 'members_only' || kind === 'chat_disabled' || kind === 'ended') {
        stopReason = kind
        break
      }
      continuation = null
      continuationKind = null
      await sleep(Math.min(backoff, 60_000))
      backoff = Math.min(backoff * 2, 60_000)
      persist()
      continue
    }

    if (hasApiError(payload)) {
      const message = JSON.stringify(payload)
      const kind = classifyChatError(message)
      lastError = message
      log.info(`${videoId} 上游错误（${kind}）：${message.slice(0, 200)}`)
      if (kind === 'members_only' || kind === 'chat_disabled' || kind === 'ended') {
        stopReason = kind
        break
      }
      continuation = null
      continuationKind = null
      await sleep(Math.min(backoff, 60_000))
      backoff = Math.min(backoff * 2, 60_000)
      persist()
      continue
    }

    const messageResult = extractChatItems(payload, videoId, emojis)
    const eventResult = extractChatEvents(payload, videoId, {
      now: Math.round(Date.now() / 1000),
      emojis,
    })
    const records = [...eventResult.messages, ...messageResult.records]
    const skipped = { ...messageResult.skipped, ...eventResult.skipped }
    const lines: string[] = []
    let added = 0
    let duplicatesThisPoll = 0
    for (const record of records) {
      const key = danmakuKey(record)
      if (seen.has(key)) {
        duplicatesThisPoll += 1
        continue
      }
      seen.add(key)
      record.seq = ++seq
      indexRecord(record)
      lines.push(JSON.stringify(record))
      added += 1
    }
    duplicates += duplicatesThisPoll

    const eventLines: string[] = []
    let eventsAdded = 0
    for (const event of eventResult.events) {
      const key = chatEventKey(event)
      if (seenEvents.has(key))
        continue
      seenEvents.add(key)
      decorateEvent(event)
      event.seq = ++eventSeq
      eventLines.push(JSON.stringify(event))
      eventsAdded += 1
    }

    if (!options.dryRun && (lines.length > 0 || eventLines.length > 0)) {
      if (lines.length > 0)
        appendFileSync(livePath, `${lines.join('\n')}\n`, 'utf8')
      if (eventLines.length > 0)
        appendFileSync(eventsPath, `${eventLines.join('\n')}\n`, 'utf8')
      if (emojis.size > 0)
        writeEmojiSidecar(livePath, videoId, emojis)
    }

    state.polls += 1
    lastError = null
    const skippedDetail = Object.entries(skipped)
      .map(([kind, count]) => `${kind.replace(/^liveChat|Renderer$/g, '')} ${count}`)
      .join(' / ')
    log.info(`${videoId} ${disposition} +${added}（重复 ${duplicatesThisPoll} / 合计 ${seen.size} / 事件 +${eventsAdded}（合计 ${seenEvents.size}） / 轮询 ${state.polls}）${skippedDetail ? ` 跳过 ${skippedDetail}` : ''}`)
    persist()

    if (options.once) {
      stopReason = 'once'
      break
    }

    const next = extractPollContinuation(payload)
    if (!next) {
      continuation = null
      continuationKind = null
      await sleep(3000)
      continue
    }
    continuation = next.token
    continuationKind = next.kind
    await sleep(pollDelayMs(payload, { minMs: options.minInterval, maxMs: options.maxInterval }))
  }

  process.removeListener('SIGINT', onSignal)
  state.stopReason = stopReason ?? (running ? 'done' : 'interrupted')
  persist()
  log.info(`${videoId} 结束（${state.stopReason}）：合计 ${seen.size} 条，事件 ${seenEvents.size} 条，重复 ${duplicates}，轮询 ${state.polls}；${options.dryRun ? 'dry-run 未写入' : `输出 ${livePath}`}`)

  summary.stopReason = state.stopReason
  summary.stored = seen.size
  summary.events = seenEvents.size
  summary.duplicates = duplicates
  summary.polls = state.polls
  summary.error = lastError
  return summary
}

/**
 * InnerTube 实时弹幕采集：等待室历史 / 直播中跟随 / 结束后转完整回放。
 *
 * 进程内可调用：不读 process.argv、不调用 process.exit（失败从 `exitCode` 反映），
 * 进度与上游错误走注入的 `log`；单场失败只记录，不阻塞其余场次。
 */
export async function runLiveChat(
  options: RunLiveChatOptions = {},
): Promise<{ exitCode: number, data?: LiveChatRunResult }> {
  const log = options.log ?? SILENT_LOG

  const rawIds: string[] = []
  if (options.video)
    rawIds.push(options.video)
  if (options.ids) {
    const path = resolve(options.ids)
    if (!existsSync(path)) {
      throw new CliError(`找不到 ID 列表：${path}`, {
        code: 'MISSING_IDS_FILE',
        hint: '确认 --ids 的路径，或用 --video 单个指定',
        context: { path },
      })
    }
    rawIds.push(...readFileSync(path, 'utf8').split(/\r?\n/))
  }
  const ids = [...new Set(rawIds.map(videoIdOf).filter((id): id is string => id !== null))]
  if (ids.length === 0) {
    throw new UsageError('请用 --video <id> 或 --ids <文件> 指定视频', {
      hint: '例如 bun run ymmt data live-chat --video fmjJNbzcr3g',
    })
  }

  const sources = existsSync(CONFIG_PATH)
    ? readJson<{ datasets?: DatasetSource[] }>(CONFIG_PATH).datasets ?? []
    : []

  const dryRun = options.dryRun === true
  const root = resolve(options.root ?? process.env.STREAM_SESSION_ROOT ?? join(APP_ROOT, 'temp', 'youtube-live'))
  const dataRoot = join(APP_ROOT, 'data')
  if (root === dataRoot || root.startsWith(`${dataRoot}${sep}`)) {
    throw new UsageError('--root 是原始素材目录，不能指向 data/', {
      hint: '用归档工程的会话根目录，例如 --root "D:/projects/claude-messages/temp/youtube-live"',
      context: { root },
    })
  }
  if (!dryRun) {
    mkdirSync(root, { recursive: true })
    if ((root.startsWith(`${APP_ROOT}/`) || root.startsWith(`${APP_ROOT}\\`)) && !existsSync(join(root, '.gitignore')))
      writeFileSync(join(root, '.gitignore'), '*\n', 'utf8')
  }

  const cookie = await resolveChatCookie(ids[0]!, {
    cookie: options.cookie,
    cookies: options.cookies,
    browser: options.cookiesFromBrowser ?? DEFAULT_COOKIE_BROWSER,
    cachePath: options.cookieCache,
    disable: options.noCookies,
  }, log)

  const minInterval = Math.max(1000, options.minInterval ?? DEFAULT_MIN_INTERVAL_MS)
  const maxInterval = Math.max(1000, options.maxInterval ?? DEFAULT_MAX_INTERVAL_MS)
  if (maxInterval < minInterval) {
    throw new UsageError('--max-interval 不能小于 --min-interval', {
      hint: '例如 --min-interval 1000 --max-interval 15000',
      context: { minInterval, maxInterval },
    })
  }

  const collect: CollectOptions = {
    root,
    cookie,
    minInterval,
    maxInterval,
    once: options.once === true,
    dryRun,
    maxHours: Math.max(0, options.maxHours ?? 0),
    datasetId: options.dataset,
    replay: options.noReplay !== true,
    pageDelayMs: Math.max(0, options.pageDelay ?? DEFAULT_PAGE_DELAY_MS),
    maxPages: Math.max(0, options.maxPages ?? 0),
    log,
  }
  if (!cookie)
    log.info('未提供 cookie：公开场次可采集；会员限定场次会停在 unplayable')

  // 多视频时 Ctrl-C 一次就整体停下，不要继续下一个场次。
  let interrupted = false
  const onInterrupt = (): void => {
    interrupted = true
  }
  process.once('SIGINT', onInterrupt)

  const videos: CollectVideoSummary[] = []
  let failures = 0
  try {
    for (const videoId of ids) {
      if (interrupted)
        break
      try {
        const summary = await collectVideo(videoId, collect, sources)
        videos.push(summary)
        if (summary.error && !summary.session)
          failures += 1
      }
      catch (error) {
        failures += 1
        log.error(`${videoId} 失败：${describe(error)}`)
        videos.push({
          videoId,
          label: 'unknown',
          session: null,
          stopReason: 'error',
          stored: 0,
          events: 0,
          duplicates: 0,
          polls: 0,
          error: describe(error),
        })
      }
    }
  }
  finally {
    process.removeListener('SIGINT', onInterrupt)
  }

  return { exitCode: failures > 0 ? 1 : 0, data: { videos, failures } }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** `--no-x` 形式的开关在 commander 里是 `<x>: false`；true/false 都表示没传。 */
function negated(ctx: { options: Record<string, unknown> }, name: string): boolean {
  return ctx.options[name] === false
}

/** `data live-chat`：InnerTube 实时聊天采集。 */
export const dataLiveChatSpec: CommandSpec<LiveChatRunResult> = {
  id: 'data.live-chat',
  description: 'InnerTube 实时聊天采集（等待室 / 直播中 / 结束后转回放）',
  details: '开播前 / 直播中通过 InnerTube 采集弹幕，写 danmaku_live_<videoId>.jsonl。\n'
    + '直播已结束时自动改走 InnerTube 回放，写 danmaku_<videoId>.jsonl + events_<videoId>.jsonl。\n\n'
    + '停止条件：直播结束、聊天被禁用、播放器受限且没有弹幕 token、--max-hours 到点或 Ctrl-C。\n'
    + '等待室（LIVE_STREAM_OFFLINE）不是终态，会继续轮询。',
  examples: [
    'bun run ymmt data live-chat --video fmjJNbzcr3g',
    'bun run ymmt data live-chat --dataset yuno --ids temp/live-ids.txt --once',
    'bun run ymmt data live-chat --video fmjJNbzcr3g --max-hours 3 --json',
  ],
  options: [
    new Option('--video <id>', '单个视频 ID'),
    new Option('--ids <文件>', '视频 ID 列表（每行一个）'),
    new Option('--dataset <id>', '强制指定 dataset；默认按 watch 页的 channelId 匹配'),
    new Option('--root <目录>', '会话根目录（默认 $STREAM_SESSION_ROOT 或 ./temp/youtube-live）'),
    new Option('--cookie <字符串>', 'Cookie 请求头（会员限定需要）；也可用环境变量 YT_COOKIE'),
    new Option('--cookies <文件>', 'Netscape cookie jar（yt-dlp 导出的 cookies.txt）'),
    new Option('--cookies-from-browser <b>', `导出 cookie 时用哪个浏览器，默认 ${DEFAULT_COOKIE_BROWSER}`).default(DEFAULT_COOKIE_BROWSER),
    new Option('--cookie-cache <文件>', 'cookie 缓存路径，默认 ~/yt-cookies.txt'),
    new Option('--no-cookies', '不使用 cookie，以匿名状态抓取'),
    new Option('--max-hours <n>', '最长跟随小时数，0 = 不限').default(0),
    new Option('--min-interval <ms>', `轮询间隔下限，默认 ${DEFAULT_MIN_INTERVAL_MS}`).default(DEFAULT_MIN_INTERVAL_MS),
    new Option('--max-interval <ms>', `轮询间隔上限，默认 ${DEFAULT_MAX_INTERVAL_MS}`).default(DEFAULT_MAX_INTERVAL_MS),
    new Option('--page-delay <ms>', `回放每页间隔，默认 ${DEFAULT_PAGE_DELAY_MS}`).default(DEFAULT_PAGE_DELAY_MS),
    new Option('--max-pages <n>', '回放最多翻多少页，0 = 不限').default(0),
    new Option('--once', '只取一页（等待室历史 / 定时任务），不触发完整回放'),
    new Option('--no-replay', '已结束时只报告，不自动抓回放'),
  ],
  async run(ctx) {
    const result = await runLiveChat({
      video: optionalString(ctx.options.video),
      ids: optionalString(ctx.options.ids),
      dataset: optionalString(ctx.options.dataset),
      root: optionalString(ctx.options.root),
      cookie: optionalString(ctx.options.cookie),
      cookies: optionalString(ctx.options.cookies),
      maxHours: ctx.integer('maxHours', 0, 0),
      minInterval: ctx.integer('minInterval', DEFAULT_MIN_INTERVAL_MS, 1000),
      maxInterval: ctx.integer('maxInterval', DEFAULT_MAX_INTERVAL_MS, 1000),
      pageDelay: ctx.integer('pageDelay', DEFAULT_PAGE_DELAY_MS, 0),
      maxPages: ctx.integer('maxPages', 0, 0),
      once: ctx.flag('once'),
      noReplay: negated(ctx, 'replay'),
      cookiesFromBrowser: optionalString(ctx.options.cookiesFromBrowser) ?? DEFAULT_COOKIE_BROWSER,
      cookieCache: optionalString(ctx.options.cookieCache),
      noCookies: negated(ctx, 'cookies'),
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    return { exitCode: result.exitCode, data: result.data }
  },
}
