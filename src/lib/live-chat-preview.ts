/**
 * 开发用预览：把实时采集的 `danmaku_live_*.jsonl` / `events_*.jsonl` 归一化成
 * 页面直接消费的形状。只做纯解析，不读文件；文件读取在 `/dev/live-chat` 页面里。
 *
 * 这个模块只服务内部调试，不参与线上页面与 SEO。
 */
import { emojiScope } from './emoji'

export interface PreviewEmoji {
  id: string
  name: string | null
  url: string | null
  /** 索引图加载失败时退回抓取时的 InnerTube 地址。 */
  fallbackUrl?: string | null
}

/** SC / 贴纸的等级颜色（ARGB 整数），与 `scripts/lib/live-chat.ts` 的 `colors` 对齐。 */
export interface PreviewPaidColors {
  headerBackground?: number
  headerText?: number
  bodyBackground?: number
  bodyText?: number
  authorName?: number
  timestamp?: number
  moneyChipBackground?: number
  moneyChipText?: number
  background?: number
}

export interface PreviewSticker {
  name: string | null
  url: string
}

export interface PreviewMessage {
  kind: 'message'
  ts: number
  author: string
  authorId: string | null
  chatKind: string
  text: string
  emojis: PreviewEmoji[]
  badges: string[]
  sc: string | null
  header: string | null
  membershipPrimary: string | null
  memberMessage: boolean
  colors: PreviewPaidColors | null
  sticker: PreviewSticker | null
  giftCount: number | null
  owner: boolean
  rendererId: string | null
  raw: Record<string, unknown>
}

export interface PreviewEvent {
  kind: 'event'
  ts: number
  type: string
  owner: boolean
  author: string | null
  authorId: string | null
  text: string | null
  data: Record<string, unknown> | null
  raw: Record<string, unknown>
}

export type PreviewRow = PreviewMessage | PreviewEvent

export interface PreviewCounts {
  messages: number
  events: number
  byKind: Record<string, number>
  byEvent: Record<string, number>
  uniqueAuthors: number
  ownerMessages: number
  ownerEvents: number
  emojiDistinct: number
  firstTs: number | null
  lastTs: number | null
  spanSec: number | null
}

export interface PreviewSessionMeta {
  /** 会话目录名。 */
  id: string
  videoId: string
  datasetId: string | null
  label: string | null
  title: string | null
  /** 预定开播（ISO，JST 偏移或 UTC）。 */
  startedAt: string | null
  dir: string
  updatedAt: string | null
  files: {
    messages: string | null
    events: string | null
    emoji: string | null
    state: string | null
    meta: string | null
  }
  status: Record<string, unknown> | null
}

export interface PreviewSession extends PreviewSessionMeta {
  rows: PreviewRow[]
  counts: PreviewCounts
  emojiAssets: PreviewEmoji[]
  invalid: number
}

export interface PreviewData {
  root: string
  sessions: PreviewSessionMeta[]
  session: PreviewSession | null
  error: string | null
}

interface RawDanmaku {
  seq?: number
  video?: string
  ts?: number
  rendererId?: string
  msg?: {
    author?: string
    authorId?: string
    text?: string
    kind?: string
    sc?: string | null
    timestampUs?: string | number
    emoji?: { id?: string }[]
    badges?: string[]
    header?: string
    membershipPrimary?: string
    memberMessage?: boolean
    colors?: PreviewPaidColors
    sticker?: PreviewSticker
    giftCount?: number
  }
}

interface RawEvent {
  seq?: number
  at?: number
  type?: string
  owner?: boolean
  author?: string
  authorId?: string
  text?: string | null
  data?: Record<string, unknown>
  raw?: unknown
}

export function parseJsonLines<T>(text: string): { rows: T[]; invalid: number } {
  const rows: T[] = []
  let invalid = 0
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed)
      continue
    try {
      const value = JSON.parse(trimmed) as unknown
      if (typeof value === 'object' && value !== null && !Array.isArray(value))
        rows.push(value as T)
      else
        invalid += 1
    }
    catch {
      invalid += 1
    }
  }
  return { rows, invalid }
}

function parseEmojiAssets(text: string | null): Map<string, PreviewEmoji> {
  const assets = new Map<string, PreviewEmoji>()
  if (!text)
    return assets
  try {
    const payload = JSON.parse(text) as { emojis?: { id?: unknown, name?: unknown, url?: unknown }[] }
    for (const asset of payload.emojis ?? []) {
      if (typeof asset.id !== 'string' || !asset.id || typeof asset.url !== 'string' || !asset.url)
        continue
      assets.set(asset.id, {
        id: asset.id,
        name: typeof asset.name === 'string' ? asset.name : null,
        url: asset.url,
      })
    }
  }
  catch {
    // 坏档当作没有表情表，页面仍能显示 id
  }
  return assets
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function messageTimestamp(raw: RawDanmaku): number | null {
  const direct = numberOrNull(raw.ts)
  if (direct != null)
    return direct
  const micros = numberOrNull(raw.msg?.timestampUs)
  return micros == null ? null : Math.round(micros / 1_000_000)
}

function toMessage(raw: RawDanmaku, assets: Map<string, PreviewEmoji>): PreviewMessage | null {
  const ts = messageTimestamp(raw)
  if (ts == null)
    return null
  const msg = raw.msg ?? {}
  const text = typeof msg.text === 'string' ? msg.text : ''
  const badges = Array.isArray(msg.badges) ? msg.badges.filter(badge => typeof badge === 'string') : []
  const emojis = (msg.emoji ?? [])
    .map(emoji => (typeof emoji.id === 'string' ? emoji.id : null))
    .filter((id): id is string => Boolean(id))
    .map(id => assets.get(id) ?? { id, name: null, url: null })
  // 旧数据把「会员留言」也记成 membership；带正文的按普通弹幕展示。
  let chatKind = typeof msg.kind === 'string' ? msg.kind : 'text'
  let memberMessage = msg.memberMessage === true
  if (chatKind === 'membership' && text.trim()) {
    chatKind = 'text'
    memberMessage = true
  }
  const colors = msg.colors && typeof msg.colors === 'object' ? msg.colors : null
  const sticker = msg.sticker && typeof msg.sticker === 'object' && typeof msg.sticker.url === 'string'
    ? msg.sticker
    : null
  return {
    kind: 'message',
    ts,
    author: typeof msg.author === 'string' ? msg.author : '(unknown)',
    authorId: stringOrNull(msg.authorId),
    chatKind,
    text,
    emojis,
    badges,
    sc: stringOrNull(msg.sc),
    header: stringOrNull(msg.header),
    membershipPrimary: stringOrNull(msg.membershipPrimary),
    memberMessage,
    colors,
    sticker,
    giftCount: typeof msg.giftCount === 'number' ? msg.giftCount : null,
    owner: badges.includes('Owner'),
    rendererId: stringOrNull(raw.rendererId),
    raw: raw as Record<string, unknown>,
  }
}

function toEvent(raw: RawEvent): PreviewEvent | null {
  const ts = numberOrNull(raw.at)
  if (ts == null)
    return null
  return {
    kind: 'event',
    ts,
    type: typeof raw.type === 'string' ? raw.type : 'other',
    owner: raw.owner === true,
    author: stringOrNull(raw.author),
    authorId: stringOrNull(raw.authorId),
    text: typeof raw.text === 'string' ? raw.text : null,
    data: raw.data && typeof raw.data === 'object' ? raw.data : null,
    raw: raw as Record<string, unknown>,
  }
}

/** 频道 ID → dataset；只用于导入文件时推断表情索引目录。 */
export const DATASET_BY_CHANNEL: Record<string, string> = {
  UCGeCnpimiSN5rgiKbJzHd3A: 'nonoka',
  UCWfF0DB6m_t2CE3KcOOOX7g: 'arale',
  UCxc0MrPoACKTFlV24GqX2sg: 'ritsu',
  UCZXxRYaP7mfuglPnptnBBCA: 'miyako',
  UC99kOG6_9RD0mR3OG4EOfxw: 'yuno',
}

function mergePollEvents(events: PreviewEvent[]): PreviewEvent[] {
  const merged: PreviewEvent[] = []
  const pollIndex = new Map<string, number>()
  for (const event of events) {
    if (event.type !== 'poll' && event.type !== 'pollUpdate') {
      merged.push(event)
      continue
    }
    const key = typeof event.data?.pollKey === 'string' && event.data.pollKey
      ? event.data.pollKey
      : typeof event.data?.snapshotKey === 'string' ? event.data.snapshotKey : event.type
    const index = pollIndex.get(key)
    if (index == null) {
      pollIndex.set(key, merged.length)
      merged.push({ ...event, data: { ...(event.data ?? {}), snapshotCount: 1 } })
      continue
    }
    const existing = merged[index]!
    const count = typeof existing.data?.snapshotCount === 'number' ? existing.data.snapshotCount : 1
    existing.data = {
      ...(existing.data ?? {}),
      ...(event.data ?? {}),
      snapshotCount: count + 1,
      updatedAtTs: event.ts,
    }
    existing.text = existing.text ?? event.text
    existing.author = existing.author ?? event.author
    existing.authorId = existing.authorId ?? event.authorId
    existing.owner = existing.owner || event.owner
  }
  return merged
}

export function inferDatasetId(session: PreviewSession | null): string | null {
  if (!session)
    return null
  if (session.datasetId)
    return session.datasetId
  for (const emoji of session.emojiAssets) {
    const scope = emojiScope(emoji.id)
    const dataset = scope ? DATASET_BY_CHANNEL[scope] : undefined
    if (dataset)
      return dataset
  }
  return null
}

export function buildPreviewSession(input: {
  meta: PreviewSessionMeta
  messagesText: string
  eventsText: string
  emojiText: string | null
}): PreviewSession {
  const assets = parseEmojiAssets(input.emojiText)
  const messageParse = parseJsonLines<RawDanmaku>(input.messagesText)
  const eventParse = parseJsonLines<RawEvent>(input.eventsText)
  const messages = messageParse.rows
    .map(raw => toMessage(raw, assets))
    .filter((row): row is PreviewMessage => row !== null)
  const events = mergePollEvents(
    eventParse.rows
      .map(toEvent)
      .filter((row): row is PreviewEvent => row !== null),
  )
  const rows: PreviewRow[] = [...messages, ...events].sort((a, b) => {
    if (a.ts !== b.ts)
      return a.ts - b.ts
    // 同一秒内消息在前，事件在后；保持解析顺序（sort 稳定）。
    return a.kind === b.kind ? 0 : a.kind === 'message' ? -1 : 1
  })

  const byKind: Record<string, number> = {}
  for (const message of messages)
    byKind[message.chatKind] = (byKind[message.chatKind] ?? 0) + 1
  const byEvent: Record<string, number> = {}
  for (const event of events)
    byEvent[event.type] = (byEvent[event.type] ?? 0) + 1

  const authors = new Set<string>()
  for (const message of messages)
    authors.add(message.authorId ?? message.author)
  for (const event of events) {
    if (event.authorId)
      authors.add(event.authorId)
    else if (event.author)
      authors.add(event.author)
  }
  const emojiIds = new Set<string>()
  for (const message of messages) {
    for (const emoji of message.emojis)
      emojiIds.add(emoji.id)
  }

  const firstTs = rows[0]?.ts ?? null
  const lastTs = rows.at(-1)?.ts ?? null

  return {
    ...input.meta,
    rows,
    counts: {
      messages: messages.length,
      events: events.length,
      byKind,
      byEvent,
      uniqueAuthors: authors.size,
      ownerMessages: messages.filter(message => message.owner).length,
      ownerEvents: events.filter(event => event.owner).length,
      emojiDistinct: emojiIds.size,
      firstTs,
      lastTs,
      spanSec: firstTs != null && lastTs != null ? lastTs - firstTs : null,
    },
    emojiAssets: [...assets.values()].sort((a, b) => a.id.localeCompare(b.id)),
    invalid: messageParse.invalid + eventParse.invalid,
  }
}

export function buildImportedSession(name: string, text: string): PreviewSession {
  const parsed = parseJsonLines<Record<string, unknown>>(text)
  const messages: Record<string, unknown>[] = []
  const events: Record<string, unknown>[] = []
  for (const row of parsed.rows) {
    if (row.msg && typeof row.msg === 'object')
      messages.push(row)
    else if (typeof row.type === 'string' && typeof row.at === 'number')
      events.push(row)
  }
  if (messages.length === 0 && events.length === 0)
    throw new Error('没有识别到弹幕或事件行（需要 msg 或 at + type 字段）')

  const videoId = typeof messages[0]?.video === 'string' ? messages[0].video : 'imported'
  const meta: PreviewSessionMeta = {
    id: name,
    videoId,
    datasetId: null,
    label: null,
    title: name,
    startedAt: null,
    dir: '',
    updatedAt: new Date().toISOString(),
    files: { messages: name, events: null, emoji: null, state: null, meta: null },
    status: null,
  }
  return buildPreviewSession({
    meta,
    messagesText: messages.map(row => JSON.stringify(row)).join('\n'),
    eventsText: events.map(row => JSON.stringify(row)).join('\n'),
    emojiText: null,
  })
}

export const CHAT_KIND_LABELS: Record<string, string> = {
  text: '文字',
  superchat: 'Super Chat',
  sticker: '贴纸',
  membership: '会员',
  gift: '赠送会员',
  giftRedemption: '领取赠礼',
}

export const EVENT_TYPE_LABELS: Record<string, string> = {
  banner: '置顶',
  bannerRemoved: '取消置顶',
  poll: '投票',
  pollUpdate: '投票更新',
  qna: 'Q&A',
  product: '商品',
  system: '系统',
  modeChange: '模式变更',
  deleted: '删除消息',
  deletedAuthor: '删除作者消息',
  replaced: '替换消息',
  panel: '面板',
  other: '其他',
}

export function chatKindLabel(kind: string): string {
  return CHAT_KIND_LABELS[kind] ?? kind
}

export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? type
}
