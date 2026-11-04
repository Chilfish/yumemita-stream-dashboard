/**
 * 已结束场次的弹幕回放（InnerTube `get_live_chat_replay`）。
 *
 * yt-dlp 的 `live_chat` 字幕需要登录态，回放也只有消息、没有置顶 / 投票等事件；
 * InnerTube 回放用 watch 页的 `liveChatRenderer` token 即可匿名翻完整个回放，
 * 并且与实时采集共用同一套归一化：消息 → `danmaku_<videoId>.jsonl`，
 * 非消息事件 → `events_<videoId>.jsonl`，频道表情 → `emoji_<videoId>.json`。
 *
 * 分页特点：
 * - 一页约 50 条消息（5 秒窗口），续页在 `liveChatReplayContinuationData`；
 * - `playerSeekContinuationData` 是「跳到某个播放进度」，不是续页，不能用它翻页；
 * - 极少数被删除 / 封禁账号的旧消息只存在于 yt-dlp 历史字幕档，InnerTube 回放里没有；
 *   已有 jsonl 时按「rendererId + 内容」双键合并，不会丢旧数据。
 *
 * 断点续跑：续页 token 存在 `work/replay-state.json`，中断后重新执行会接着翻；
 * token 过期（400 / 410）时自动从 watch 页重新取一次，靠去重避免重复入库。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DanmakuKeySet, loadDanmakuFile, mergeDanmakuFiles, writeDanmakuFile } from './danmaku-merge.ts'
import {
  classifyChatError,
  extractChatItems,
  extractReplayContinuation,
  extractWatchPage,
  hasApiError,
  INNERTUBE_CONTEXT,
  LIVE_CHAT_REPLAY_API_URL,
  WATCH_URL,
  WEB_HEADERS,
  type WatchPage,
} from './innertube-live.ts'
import { chatEventKey, extractChatEvents, type ChatEventRecord } from './live-chat-events.ts'
import { writeEmojiSidecar, type ChatEmoji } from './live-chat.ts'

const STATE_VERSION = 1

/** 回放首屏的播放器提示（抓取时刻的时间戳），不当作直播事件。 */
const REPLAY_NOTICE_RE = /live chat replay is on/i

export type ReplayStatus = 'done' | 'no-replay' | 'live' | 'partial' | 'failed'

export interface ReplayCollectOptions {
  videoId: string
  /** 会话目录（`<root>/<日期>_<成员>_<videoId>`）。 */
  session: string
  cookie?: string | null
  /** 每页之间的等待，默认 150ms；0 = 不等待。 */
  pageDelayMs?: number
  /** 最多翻多少页，0 = 不限（安全阀）。 */
  maxPages?: number
  /** 有未完成的 state 时接着翻，默认 true。 */
  resume?: boolean
  dryRun?: boolean
  log?: (line: string) => void
}

export interface ReplayResult {
  status: ReplayStatus
  videoId: string
  session: string
  output: string
  eventsOutput: string
  pages: number
  /** 本次新增消息条数。 */
  added: number
  /** 合并后文件里的消息总条数。 */
  total: number
  events: number
  duplicates: number
  skipped: number
  emojis: number
  lastTs: number | null
  error?: string
}

interface ReplayState {
  version: number
  videoId: string
  session: string
  continuation: string | null
  pages: number
  lastSeq: number
  stored: number
  eventsStored: number
  duplicates: number
  lastTs: number | null
  updatedAt: string
  stopReason: string | null
}

class ReplayHttpError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function chatHeaders(cookie: string | null | undefined): Record<string, string> {
  return cookie ? { ...WEB_HEADERS, Cookie: cookie } : { ...WEB_HEADERS }
}

/**
 * watch 页拿不到 channelId（bot 校验 / 受限）时，用本地 pack 反查 dataset。
 * 只用来决定会话目录与 dataset 标签，不读 pack 内容。
 */
export function datasetForVideo(appRoot: string, videoId: string): { id: string, label: string } | null {
  try {
    const config = JSON.parse(readFileSync(join(appRoot, 'data-sources.json'), 'utf8')) as {
      datasets?: { id?: string, label?: string, datapackDir?: string }[]
    }
    for (const source of config.datasets ?? []) {
      if (!source.id)
        continue
      const dir = source.datapackDir ?? `data/${source.id}`
      if (existsSync(join(appRoot, dir, `${videoId}.datapack.json`)))
        return { id: source.id, label: source.label ?? source.id }
    }
  }
  catch {
    // 没有 data-sources.json 就是无从推断，调用方继续用 unknown
  }
  return null
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function loadState(path: string, videoId: string): ReplayState | null {
  if (!existsSync(path))
    return null
  try {
    const state = readJson<ReplayState>(path)
    return state.videoId === videoId ? state : null
  }
  catch {
    return null
  }
}

function saveState(path: string, state: ReplayState): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
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
    // 坏档按不存在处理，写回时重建
  }
  return emojis
}

async function fetchWatchPage(videoId: string, headers: Record<string, string>): Promise<WatchPage> {
  const response = await fetch(WATCH_URL(videoId), { headers })
  if (!response.ok)
    throw new ReplayHttpError(`watch_page_http_${response.status}`, response.status, '')
  return extractWatchPage(await response.text())
}

async function fetchReplayPage(continuation: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(LIVE_CHAT_REPLAY_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ context: INNERTUBE_CONTEXT, continuation }),
  })
  const body = await response.text()
  if (!response.ok)
    throw new ReplayHttpError(`live_chat_replay_http_${response.status}`, response.status, body)
  try {
    return JSON.parse(body) as unknown
  }
  catch (error) {
    throw new Error(`live_chat_replay_bad_json: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 429 / 5xx / 网络错误按平台建议退避重试；其余错误交给调用方处理。 */
async function fetchReplayPageWithRetry(
  continuation: string,
  headers: Record<string, string>,
  log: (line: string) => void,
): Promise<unknown> {
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await fetchReplayPage(continuation, headers)
    }
    catch (error) {
      lastError = error
      const status = error instanceof ReplayHttpError ? error.status : undefined
      const transient = status == null || status === 429 || status >= 500
      if (!transient)
        throw error
      const waitMs = Math.min(60_000, 5_000 * 2 ** attempt)
      log(`回放请求失败（${status ?? 'network'}），${Math.round(waitMs / 1000)}s 后重试`)
      await sleep(waitMs)
    }
  }
  throw lastError
}

/**
 * 翻完一场回放并把消息 / 事件 / 表情写进会话目录。
 *
 * 返回 `no-replay` 表示没有可翻的聊天（未开弹幕 / 播放器受限）；
 * 返回 `live` 表示仍在直播或等待室，应改用实时采集；
 * 返回 `failed` 表示 watch 页或首屏请求失败，调用方可回退 yt-dlp。
 */
export async function collectReplay(options: ReplayCollectOptions): Promise<ReplayResult> {
  const { videoId, session } = options
  const log = options.log ?? (() => {})
  const headers = chatHeaders(options.cookie)
  const pageDelayMs = Math.max(0, options.pageDelayMs ?? 150)
  const maxPages = Math.max(0, options.maxPages ?? 0)
  const danmakuDir = join(session, 'danmaku')
  const workDir = join(session, 'work')
  const output = join(danmakuDir, `danmaku_${videoId}.jsonl`)
  const livePath = join(danmakuDir, `danmaku_live_${videoId}.jsonl`)
  const eventsOutput = join(danmakuDir, `events_${videoId}.jsonl`)
  const emojiPath = join(danmakuDir, `emoji_${videoId}.json`)
  const statePath = join(workDir, 'replay-state.json')

  const result: ReplayResult = {
    status: 'failed',
    videoId,
    session,
    output,
    eventsOutput,
    pages: 0,
    added: 0,
    total: 0,
    events: 0,
    duplicates: 0,
    skipped: 0,
    emojis: 0,
    lastTs: null,
  }

  let page: WatchPage
  try {
    page = await fetchWatchPage(videoId, headers)
  }
  catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    return result
  }

  const watchToken = page.continuation?.token ?? null
  if (!watchToken) {
    result.status = page.status.isReplay === true ? 'no-replay' : 'live'
    return result
  }
  if (page.status.isReplay !== true) {
    // 等待室 / 直播中的 token 打回放端点会 400；交给实时采集。
    result.status = 'live'
    return result
  }

  if (!options.dryRun) {
    mkdirSync(danmakuDir, { recursive: true })
    mkdirSync(workDir, { recursive: true })
  }

  const loaded = loadDanmakuFile(output)
  if (loaded.invalid > 0 && !options.dryRun)
    writeDanmakuFile(output, loaded.records)
  const seen = new DanmakuKeySet()
  let lastSeq = 0
  let lastTs: number | null = null
  for (const record of loaded.records) {
    seen.add(record)
    const ts = typeof record.ts === 'number' && Number.isFinite(record.ts) ? record.ts : 0
    if (ts > 0 && (lastTs === null || ts > lastTs))
      lastTs = ts
    const seq = typeof record.seq === 'number' ? record.seq : 0
    if (seq > lastSeq)
      lastSeq = seq
  }

  const loadedEvents = loadDanmakuFile(eventsOutput)
  if (loadedEvents.invalid > 0 && !options.dryRun)
    writeDanmakuFile(eventsOutput, loadedEvents.records)
  const seenEvents = new Set<string>()
  let eventSeq = 0
  for (const raw of loadedEvents.records) {
    const event = raw as unknown as ChatEventRecord
    seenEvents.add(chatEventKey(event))
    const seq = typeof event.seq === 'number' ? event.seq : 0
    if (seq > eventSeq)
      eventSeq = seq
  }

  const emojis = readEmojiSidecar(emojiPath)

  const prior = options.resume === false ? null : loadState(statePath, videoId)
  if (prior?.stopReason === 'done' && !prior.continuation && options.resume !== false && existsSync(output)) {
    result.status = 'done'
    result.pages = prior.pages
    result.total = loaded.records.length
    result.events = loadedEvents.records.length
    result.emojis = emojis.size
    result.duplicates = prior.duplicates ?? 0
    result.lastTs = lastTs
    log(`${videoId} 回放已翻完（${result.total} 条），跳过；加 --force 可重抓`)
    return result
  }
  let continuation = prior?.continuation ?? watchToken
  let pages = prior?.continuation ? (prior.pages ?? 0) : 0
  let startedPages = pages
  let duplicates = prior?.duplicates ?? 0
  let skipped = 0
  let addedTotal = 0
  let eventsAddedTotal = 0
  let eventsTotal: number | null = null
  let rateLimitHits = 0
  const state: ReplayState = {
    version: STATE_VERSION,
    videoId,
    session,
    continuation,
    pages,
    lastSeq,
    stored: loaded.records.length,
    eventsStored: loadedEvents.records.length,
    duplicates,
    lastTs,
    updatedAt: new Date().toISOString(),
    stopReason: null,
  }
  const persist = (): void => {
    state.continuation = continuation
    state.pages = pages
    state.lastSeq = lastSeq
    state.stored = loaded.records.length + addedTotal
    state.eventsStored = loadedEvents.records.length + eventsAddedTotal
    state.duplicates = duplicates
    state.lastTs = lastTs
    state.updatedAt = new Date().toISOString()
    if (!options.dryRun)
      saveState(statePath, state)
  }

  log(`${videoId} 回放 start（已有 ${loaded.records.length} 条，续页 ${prior?.continuation ? '有' : '无'}）`)

  let restarted = false
  let stopReason: string | null = null
  for (;;) {
    if (maxPages > 0 && pages - startedPages >= maxPages) {
      stopReason = 'max_pages'
      break
    }

    let payload: unknown
    try {
      payload = await fetchReplayPageWithRetry(continuation, headers, line => log(`${videoId} ${line}`))
    }
    catch (error) {
      const status = error instanceof ReplayHttpError ? error.status : undefined
      if (!restarted && (status === 400 || status === 403 || status === 404 || status === 410)) {
        // 续页 token 过期：从 watch 页重新取一次，继续翻；去重会挡住重复消息。
        restarted = true
        log(`${videoId} 续页 token 失效（${status}），从 watch 页重新取`)
        try {
          const fresh = await fetchWatchPage(videoId, headers)
          const token = fresh.continuation?.token ?? null
          if (token) {
            continuation = token
            pages = 0
            startedPages = 0
            continue
          }
        }
        catch {
          // 落到下面的失败分支
        }
      }
      result.status = 'failed'
      result.error = error instanceof Error ? error.message : String(error)
      stopReason = 'error'
      break
    }

    if (hasApiError(payload)) {
      const message = JSON.stringify(payload)
      const kind = classifyChatError(message)
      result.error = message.slice(0, 300)
      stopReason = kind
      if (kind === 'rate_limited' && rateLimitHits < 3) {
        rateLimitHits += 1
        persist()
        log(`${videoId} 被限流，等待 15s 后重试（${rateLimitHits}/3）`)
        await sleep(15_000)
        continue
      }
      result.status = 'failed'
      break
    }

    pages += 1
    const items = extractChatItems(payload, videoId, emojis)
    const events = extractChatEvents(payload, videoId, {
      now: lastTs ?? Math.round(Date.now() / 1000),
      emojis,
    })
    for (const [, count] of Object.entries({ ...items.skipped, ...events.skipped }))
      skipped += count

    const lines: string[] = []
    let added = 0
    let duplicatesThisPage = 0
    for (const record of items.records) {
      if (seen.has(record)) {
        duplicatesThisPage += 1
        continue
      }
      seen.add(record)
      record.seq = ++lastSeq
      if (record.ts > 0 && (lastTs === null || record.ts > lastTs))
        lastTs = record.ts
      lines.push(JSON.stringify(record))
      added += 1
    }
    duplicates += duplicatesThisPage

    const eventLines: string[] = []
    let eventsAdded = 0
    for (const event of events.events) {
      // 回放页自带的「Live chat replay is on」是播放器提示，时间戳是抓取时刻，不是直播事件。
      if (event.type === 'system' && REPLAY_NOTICE_RE.test(event.text ?? ''))
        continue
      const key = chatEventKey(event)
      if (seenEvents.has(key))
        continue
      seenEvents.add(key)
      event.seq = ++eventSeq
      eventLines.push(JSON.stringify(event))
      eventsAdded += 1
    }

    if (!options.dryRun && (lines.length > 0 || eventLines.length > 0)) {
      if (lines.length > 0)
        appendFileSync(output, `${lines.join('\n')}\n`, 'utf8')
      if (eventLines.length > 0)
        appendFileSync(eventsOutput, `${eventLines.join('\n')}\n`, 'utf8')
    }
    addedTotal += added
    eventsAddedTotal += eventsAdded

    const next = extractReplayContinuation(payload)
    if (pages % 10 === 0 || !next) {
      log(`${videoId} 回放 ${pages} 页 +${addedTotal}（重复 ${duplicatesThisPage} / 合计 ${loaded.records.length + addedTotal} / 事件 ${eventsAddedTotal} / 跳过 ${skipped}）`)
      persist()
    }
    if (!next) {
      stopReason = 'done'
      break
    }
    continuation = next.token
    if (pageDelayMs > 0)
      await sleep(pageDelayMs)
  }

  // 合并旧档（yt-dlp 有 id 缺失的历史字幕）并重排 seq；有实时采集时一并并进来。
  if (!options.dryRun && (addedTotal > 0 || existsSync(output))) {
    try {
      if (existsSync(output))
        mergeDanmakuFiles(existsSync(livePath) ? [output, livePath] : [output], output)
    }
    catch (error) {
      log(`${videoId} 合并回放失败：${error instanceof Error ? error.message : String(error)}`)
    }

    if (existsSync(eventsOutput)) {
      const finalEvents = loadDanmakuFile(eventsOutput).records
      finalEvents.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))
      finalEvents.forEach((event, index) => {
        event.seq = index + 1
      })
      writeDanmakuFile(eventsOutput, finalEvents)
      eventsTotal = finalEvents.length
    }
    if (emojis.size > 0)
      writeEmojiSidecar(output, videoId, emojis)
  }

  result.pages = pages
  result.added = addedTotal
  result.total = options.dryRun
    ? loaded.records.length + addedTotal
    : loadDanmakuFile(output).records.length
  result.events = eventsTotal ?? eventsAddedTotal
  result.duplicates = duplicates
  result.skipped = skipped
  result.emojis = emojis.size
  result.lastTs = lastTs

  if (stopReason === 'done' && result.total > 0)
    result.status = 'done'
  else if (stopReason === 'done' || stopReason === 'max_pages')
    result.status = result.total > 0 ? 'partial' : 'no-replay'
  else if (result.status !== 'failed')
    result.status = result.total > 0 ? 'partial' : 'failed'

  if (stopReason === 'done')
    continuation = null
  state.stopReason = stopReason
  persist()
  log(`${videoId} 回放结束（${stopReason ?? 'unknown'}）：新增 ${result.added}，合计 ${result.total}，事件 ${result.events}${result.error ? `，错误：${result.error}` : ''}`)
  return result
}
