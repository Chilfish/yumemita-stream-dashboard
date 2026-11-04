/**
 * InnerTube 实时弹幕（等待室 / 直播中）协议解析与消息提取。
 *
 * yt-dlp 的 `live_chat` 字幕只在直播结束后才有；等待室与直播中的弹幕只能走
 * `youtubei/v1/live_chat/get_live_chat`。本模块只做纯函数解析与外发请求所需常量，
 * 网络调用留给 `scripts/fetch-live-chat.ts`。
 *
 * 关键差异（与 `live-chat.ts` 的回放路径）：
 * - watch 页必须带浏览器 UA + `hl=en`，否则 YouTube 会回剥离版页面（没有 `liveChatRenderer`）。
 * - 等待室只给 `reloadContinuationData`，所以要按 reload → timed → invalidation → replay 的优先级取。
 * - `LIVE_STREAM_OFFLINE` 只是「播放器还不能播」，等待室弹幕此时已经可用，不能当终态。
 */
import type { ChatEmoji, ChatItemWrapper, ChatRecord } from './live-chat.ts'
import { readFileSync } from 'node:fs'
import { toRecord } from './live-chat.ts'

export const WATCH_URL = (videoId: string): string =>
  `https://www.youtube.com/watch?v=${videoId}&hl=en`

export const LIVE_CHAT_API_URL
  = 'https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false'

/**
 * 完整 Chrome UA + `hl=en`：徽章文案与现有 pack 的英文口径一致（`Member` / `New member`），
 * 同时避免 `/live_chat_replay` 与 watch 页的浏览器嗅探回精简版。
 */
export const WEB_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Content-Type': 'application/json',
  'X-YouTube-Client-Name': '1',
  'X-YouTube-Client-Version': '2.20240101.00.00',
}

export const INNERTUBE_CONTEXT = {
  client: {
    clientName: 'WEB',
    clientVersion: '2.20240101.00.00',
    hl: 'en',
  },
} as const

export type ContinuationKind = 'reload' | 'timed' | 'invalidation' | 'replay'

export interface Continuation {
  token: string
  kind: ContinuationKind
}

export interface WatchStatus {
  /** `playabilityStatus.status`。 */
  playability: string | null
  /** `playabilityStatus.reason`。 */
  reason: string | null
  isLiveNow: boolean | null
  endTimestamp: string | null
  startTimestamp: string | null
  /** `videoDetails.lengthSeconds`；等待室为 0。 */
  lengthSeconds: number | null
  /** `liveChatRenderer.isReplay`；已结束直播为 `true`。 */
  isReplay: boolean | null
  /** `conversationBar.availabilityMessage`（聊天不可用时才有）。 */
  availabilityMessage: string | null
  availability: 'subscriber_only' | null
}

export type WatchDisposition = 'ended' | 'unplayable' | 'chat_disabled' | 'pending'

export interface WatchPage {
  title: string | null
  channelId: string | null
  channelName: string | null
  /** 预定开播（Unix 秒）；等待室页面通常有。 */
  scheduledStart: number | null
  status: WatchStatus
  continuation: Continuation | null
}

export interface ExtractedItems {
  records: ChatRecord[]
  /** 被丢弃的 renderer 类型 → 条数；用来发现还没收录的事件类型。 */
  skipped: Record<string, number>
}

type Json = Record<string, unknown>

const INITIAL_DATA_RES = [
  /var ytInitialData\s*=\s*(\{.*?\});<\/script>/s,
  /ytInitialData"\]\s*=\s*(\{.*?\});?\s*<\/script>/s,
]

const PLAYER_RESPONSE_RE = /ytInitialPlayerResponse\s*=\s*(\{.*?\});/s

const CONTINUATION_KEYS: readonly { key: string, kind: ContinuationKind }[] = [
  { key: 'reloadContinuationData', kind: 'reload' },
  { key: 'timedContinuationData', kind: 'timed' },
  { key: 'invalidationContinuationData', kind: 'invalidation' },
  { key: 'liveChatReplayContinuationData', kind: 'replay' },
]

const SPONSORS_ONLY_OFFER_ID = 'sponsors_only_video'
const MEMBERS_ONLY_REASON_RE = /members[- ]?only|available to this channel'?s members/i
const CHAT_DISABLED_RE = /chat (?:is )?(?:disabled|unavailable|turned off)/i
/** 只剩等待室可用：播放器不能播，但弹幕已经能取。 */
const WAITING_ROOM_PLAYABILITY = new Set(['LIVE_STREAM_OFFLINE'])

export function asRecord(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** 深度优先查找第一个同名键（与 viewer 的 `findKey` 同语义）。 */
export function findKey(node: unknown, key: string): unknown {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findKey(item, key)
      if (found != null)
        return found
    }
    return undefined
  }
  const record = asRecord(node)
  if (!record)
    return undefined
  if (key in record)
    return record[key]
  for (const value of Object.values(record)) {
    const found = findKey(value, key)
    if (found != null)
      return found
  }
  return undefined
}

function parseJson(html: string, patterns: readonly RegExp[]): unknown | null {
  for (const pattern of patterns) {
    const raw = pattern.exec(html)?.[1]
    if (!raw)
      continue
    try {
      return JSON.parse(raw) as unknown
    }
    catch {
      continue
    }
  }
  return null
}

export function parseInitialData(html: string): unknown | null {
  return parseJson(html, INITIAL_DATA_RES)
}

export function parsePlayerResponse(html: string): unknown | null {
  return parseJson(html, [PLAYER_RESPONSE_RE])
}

/** 按 reload → timed → invalidation → replay 的优先级取第一个可用 token（跨项优先，不只数组顺序）。 */
export function selectContinuation(continuations: unknown): Continuation | null {
  const items = asArray(continuations)
  for (const { key, kind } of CONTINUATION_KEYS) {
    for (const item of items) {
      const data = asRecord(asRecord(item)?.[key])
      const token = data?.continuation
      if (typeof token === 'string' && token)
        return { token, kind }
    }
  }
  return null
}

export function readMessageText(value: unknown): string | null {
  const record = asRecord(value)
  if (!record)
    return null
  if (typeof record.simpleText === 'string')
    return record.simpleText
  const runs = asArray(record.runs)
  if (runs.length === 0)
    return null
  return runs
    .map((item) => {
      const text = asRecord(item)?.text
      return typeof text === 'string' ? text : ''
    })
    .join('')
}

function readAvailability(playability: Json | null): 'subscriber_only' | null {
  if (!playability)
    return null
  if (findKey(playability.errorScreen, 'offerId') === SPONSORS_ONLY_OFFER_ID)
    return 'subscriber_only'
  const reason = playability.reason
  return typeof reason === 'string' && MEMBERS_ONLY_REASON_RE.test(reason)
    ? 'subscriber_only'
    : null
}

export function parseWatchStatus(html: string): WatchStatus {
  const player = asRecord(parsePlayerResponse(html))
  const playability = asRecord(player?.playabilityStatus)
  const details = asRecord(
    asRecord(asRecord(player?.microformat)?.playerMicroformatRenderer)?.liveBroadcastDetails,
  )
  const secondsRaw = asRecord(player?.videoDetails)?.lengthSeconds
  const seconds = typeof secondsRaw === 'number'
    ? secondsRaw
    : typeof secondsRaw === 'string' ? Number(secondsRaw) : Number.NaN

  const data = parseInitialData(html)
  const renderer = asRecord(findKey(data, 'liveChatRenderer'))
  const availabilityNode = findKey(data, 'availabilityMessage')

  return {
    playability: typeof playability?.status === 'string' ? playability.status : null,
    reason: typeof playability?.reason === 'string' ? playability.reason : null,
    isLiveNow: typeof details?.isLiveNow === 'boolean' ? details.isLiveNow : null,
    endTimestamp: typeof details?.endTimestamp === 'string' ? details.endTimestamp : null,
    startTimestamp: typeof details?.startTimestamp === 'string' ? details.startTimestamp : null,
    lengthSeconds: Number.isFinite(seconds) && (seconds as number) > 0 ? Math.round(seconds as number) : null,
    isReplay: typeof renderer?.isReplay === 'boolean' ? renderer.isReplay : null,
    availabilityMessage: readMessageText(findKey(availabilityNode, 'text')),
    availability: readAvailability(playability),
  }
}

/**
 * 四分支判定，优先级 ended → unplayable → chat_disabled → pending。
 * `LIVE_STREAM_OFFLINE` 归进 pending：它说的是播放器还不能播，不是弹幕拿不到。
 */
export function classifyWatchStatus(status: WatchStatus): WatchDisposition {
  if (status.isReplay === true || (status.isLiveNow === false && status.endTimestamp !== null))
    return 'ended'
  if (/has ended|live event has ended|is over|no longer available/i.test(status.reason ?? ''))
    return 'ended'
  if (
    status.playability !== null
    && status.playability !== 'OK'
    && !WAITING_ROOM_PLAYABILITY.has(status.playability)
  ) {
    return 'unplayable'
  }
  if (CHAT_DISABLED_RE.test(status.availabilityMessage ?? ''))
    return 'chat_disabled'
  return 'pending'
}

/** watch 页 HTML → 标题 / 频道 / 排期 / 状态 / 首个 continuation。 */
export function extractWatchPage(html: string): WatchPage {
  const player = asRecord(parsePlayerResponse(html))
  const video = asRecord(player?.videoDetails)
  const status = parseWatchStatus(html)
  const data = parseInitialData(html)
  const renderer = asRecord(findKey(data, 'liveChatRenderer'))

  let scheduledStart: number | null = null
  if (status.startTimestamp) {
    const parsed = Date.parse(status.startTimestamp)
    if (Number.isFinite(parsed))
      scheduledStart = Math.round(parsed / 1000)
  }
  if (scheduledStart == null) {
    const raw = findKey(asRecord(player?.playabilityStatus), 'scheduledStartTime')
    const value = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : Number.NaN
    if (Number.isFinite(value) && value > 0)
      scheduledStart = Math.round(value)
  }

  return {
    title: typeof video?.title === 'string' ? video.title : null,
    channelId: typeof video?.channelId === 'string' ? video.channelId : null,
    channelName: typeof video?.author === 'string' ? video.author : null,
    scheduledStart,
    status,
    continuation: renderer ? selectContinuation(renderer.continuations) : null,
  }
}

/** `continuationContents.liveChatContinuation.actions`；缺失时为 `[]`。 */
export function pollActions(payload: unknown): unknown[] {
  const continuation = asRecord(asRecord(payload)?.continuationContents)?.liveChatContinuation
  return asArray(asRecord(continuation)?.actions)
}

/** 轮询响应 → 下一条 continuation（直播 / 等待室）。 */
export function extractPollContinuation(payload: unknown): Continuation | null {
  const continuation = asRecord(asRecord(payload)?.continuationContents)?.liveChatContinuation
  return selectContinuation(asRecord(continuation)?.continuations)
}

/**
 * 轮询间隔：取最后一条带 `timeoutMs` 的 continuation，夹取到 [minMs, maxMs]。
 * YouTube 在等待室与直播态给出的 timeout 不同，按平台建议走，避免被限流。
 */
export function pollDelayMs(payload: unknown, options: { minMs?: number, maxMs?: number } = {}): number {
  const minMs = options.minMs ?? 1000
  const maxMs = options.maxMs ?? 15_000
  const continuation = asRecord(asRecord(payload)?.continuationContents)?.liveChatContinuation
  let delayMs: number | null = null
  for (const item of asArray(asRecord(continuation)?.continuations)) {
    for (const key of ['reloadContinuationData', 'timedContinuationData', 'invalidationContinuationData']) {
      const timeoutMs = asRecord(asRecord(item)?.[key])?.timeoutMs
      if (typeof timeoutMs === 'number' && timeoutMs > 0)
        delayMs = timeoutMs
    }
  }
  if (delayMs === null)
    return 5000
  return Math.min(Math.max(delayMs, minMs), maxMs)
}

export function hasApiError(payload: unknown): boolean {
  const record = asRecord(payload)
  return record !== null && 'error' in record
}

export type ChatErrorKind = 'members_only' | 'chat_disabled' | 'ended' | 'rate_limited' | 'transient'

/** 轮询失败归类：决定「停止」还是「退避重试」。 */
export function classifyChatError(message: string, httpStatus?: number): ChatErrorKind {
  if (/members[- ]?only|join this channel/i.test(message))
    return 'members_only'
  if (/chat (?:is )?(?:disabled|unavailable|turned off)/i.test(message))
    return 'chat_disabled'
  if (/live chat is no longer available|live chat has ended|stream (?:has )?ended|live event has ended|is not available/i.test(message))
    return 'ended'
  if (httpStatus === 429 || /rate.?limit|too many requests/i.test(message))
    return 'rate_limited'
  return 'transient'
}

/**
 * 轮询响应 → 归一化记录。只读 `addChatItemAction`（以及回放形态的
 * `replayChatItemAction`），ticker / banner 的重复副本按仓库既有口径忽略。
 * `seq` 一律先填 0，由调用方去重后再编号。
 */
export function extractChatItems(
  payload: unknown,
  videoId: string,
  emojis?: Map<string, ChatEmoji>,
): ExtractedItems {
  const records: ChatRecord[] = []
  const skipped: Record<string, number> = {}

  for (const action of pollActions(payload)) {
    const record = asRecord(action)
    if (!record)
      continue
    const items: ChatItemWrapper[] = []
    const replay = asRecord(record.replayChatItemAction)
    if (replay) {
      for (const inner of asArray(replay.actions)) {
        const item = asRecord(asRecord(inner)?.addChatItemAction)?.item
        if (item)
          items.push(item as ChatItemWrapper)
      }
    }
    else {
      const item = asRecord(record.addChatItemAction)?.item
      if (item)
        items.push(item as ChatItemWrapper)
    }
    for (const item of items) {
      const converted = toRecord(item, videoId, 0, emojis)
      if (!converted) {
        const kind = Object.keys(item).find(key => key.endsWith('Renderer')) ?? '(unknown item)'
        skipped[kind] = (skipped[kind] ?? 0) + 1
        continue
      }
      records.push(converted)
    }
  }

  return { records, skipped }
}

/**
 * Netscape cookie jar → `Cookie` 请求头。只保留 youtube / google 域，
 * 会员限定场次需要登录态。
 */
export function netscapeCookieHeader(path: string): string | null {
  const pairs: string[] = []
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#'))
      continue
    const fields = trimmed.split('\t')
    if (fields.length < 7)
      continue
    const domain = fields[0] ?? ''
    const name = fields[5]
    const value = fields[6]
    if (!name || !value)
      continue
    if (!/(^|\.)(youtube\.com|google\.com)$/.test(domain))
      continue
    pairs.push(`${name}=${value}`)
  }
  return pairs.length > 0 ? pairs.join('; ') : null
}
