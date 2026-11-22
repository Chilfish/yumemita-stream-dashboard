#!/usr/bin/env bun
/**
 * 一场直播的「数据包」：把 yt-dlp 的元信息・弹幕・评论区，与 VSTATS 的统计快照
 * 合并成一份归一化 JSON，供后续统计/画图/复用。
 *
 *   bun run ymmt data datapack <会话目录...>
 *
 * 会话目录（抓取侧产物，缺哪个就跳过哪块）：
 *   meta/info.json                      yt-dlp -J 原始输出
 *   danmaku/danmaku_<videoId>.jsonl     归一化弹幕
 *   danmaku/<videoId>.live_chat.json    原始 chat 回放（用来补会员里程碑文案）
 *   comments/comments_<videoId>.json    评论区（yt-dlp -J --write-comments 原样输出）
 *   web/vstats_video_<videoId>.html     VSTATS 单场页快照
 *
 * 输出（本仓库口径）：
 *   按 `info.channel_id` 在 data-sources.json 里匹配 dataset，写到
 *   `data/<datasetId>/<videoId>.datapack.json`，并 upsert `manifest.json` 摘要。
 *   匹配不到或指定 `--out` 时退回旧行为：写到 `<会话目录>/work/stream-datapack.json`。
 */
import type { Dirent } from 'node:fs'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { Option } from 'commander'
import { type Logger, type CommandSpec, UsageError } from '@chilfish/devkit/cli'
import { parseAmount } from '@scripts/lib/amount.ts'
import { upsertManifestStream } from '@scripts/lib/dataset-manifest.ts'
import { deriveVstats, parseVstats } from '@scripts/lib/vstats.ts'
import { canonicalWord, isNoiseWord, isStopword } from '@/lib/words.ts'
import type { ChatRecord } from '@scripts/lib/live-chat.ts'
import { jstIso } from '@scripts/lib/jst.ts'
import { chatTimestamp, collectMemberChats, memberChannelMap } from '@scripts/lib/member-chats.ts'

const APP_ROOT = resolve(import.meta.dir, '../../..')
const DATASOURCES_PATH = join(APP_ROOT, 'data-sources.json')

const SCHEMA = 'yumemita.stream-datapack/v2'
const ANY_DANMAKU_RE = /^danmaku_.*\.jsonl$/

/** 注入的日志器；默认静默，方便测试与进程内调用。 */
export type CommandLog = Pick<Logger, 'info' | 'warn' | 'error'>

const SILENT_LOG: CommandLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

export interface RunDatapackOptions {
  /** 会话目录（位置参数），可传多个。 */
  sessions: string[]
  /** 强制指定 dataset（默认按 channelId 匹配）。 */
  dataset?: string
  /** 输出到指定文件（仅单个会话；不更新 manifest）。 */
  out?: string
  /** VSTATS 单场页 HTML（仅单个会话，默认自动找 web/vstats_video_<id>.html）。 */
  vstats?: string
  /** 只写 datapack，不更新 manifest。 */
  skipIndex?: boolean
  /** 注入的日志器；默认静默。 */
  log?: CommandLog
}

export interface DatapackSessionResult {
  session: string
  videoId: string
  datasetId: string | null
  outPath: string
  rel: string
  manifestCount: number | null
  stats: { chat: number, authors: number, sc: number, comments: number }
}

export interface DatapackRunResult {
  written: DatapackSessionResult[]
  failures: { session: string, error: string }[]
}

interface EmojiAsset {
  id: string
  name: string | null
  url: string
}

/** 弹幕 jsonl 的一行；归一化口径与 `scripts/lib/live-chat.ts` 一致。 */
type ChatMsg = ChatRecord['msg']

interface InfoJson {
  id?: string
  title?: string
  fulltitle?: string
  duration?: number
  duration_string?: string
  release_timestamp?: number
  timestamp?: number
  upload_date?: string
  view_count?: number
  like_count?: number
  comment_count?: number
  channel_id?: string
  channel?: string
  channel_url?: string
  channel_follower_count?: number
  description?: string
  tags?: string[]
  live_status?: string
  availability?: string
  thumbnail?: string
  webpage_url?: string
  subtitles?: Record<string, unknown>
  automatic_captions?: Record<string, unknown>
  chapters?: { title?: string, start_time?: number }[]
}

interface CommentJson {
  comments?: {
    id?: string
    text?: string
    like_count?: number
    author?: string
    author_id?: string
    author_is_uploader?: boolean
    is_pinned?: boolean
    timestamp?: number
    parent?: string
  }[]
}

/** `events_<videoId>.jsonl` 的一行：实时采集侧的非消息事件（置顶 / 投票 / 系统 / 删除等）。 */
interface RawChatEvent {
  at?: number
  type?: string
  owner?: boolean
  author?: string
  authorId?: string
  text?: string | null
  id?: string
  data?: Record<string, unknown>
}

interface PackChatEvent {
  at: string
  type: string
  owner: boolean
  author?: string
  authorId?: string
  text: string | null
  data?: Record<string, unknown>
}

interface DatasetSource {
  id: string
  label: string
  channelId?: string
  manifest: string
  datapackDir: string
}

function readDatasources(): DatasetSource[] {
  if (!existsSync(DATASOURCES_PATH))
    return []
  const config = JSON.parse(readFileSync(DATASOURCES_PATH, 'utf8')) as { datasets?: DatasetSource[] }
  return config.datasets ?? []
}

function resolveDataset(
  sources: DatasetSource[],
  channelId: string | null | undefined,
  explicitId: string | undefined,
): DatasetSource | null {
  if (explicitId)
    return sources.find(source => source.id === explicitId) ?? null
  return sources.find(source => source.channelId && source.channelId === channelId) ?? null
}

function hms(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function round(n: number, digits = 2): number {
  const p = 10 ** digits
  return Math.round(n * p) / p
}

function pick(dir: string, pattern: RegExp): string | null {
  if (!existsSync(dir))
    return null
  const hit: Dirent = readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && pattern.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))[0] as Dirent
  return hit ? join(dir, hit.name) : null
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  }
  catch {
    return null
  }
}

/** 会员里程碑（入会/续费）的文案只在原始 chat 回放里，按时间戳对回去。 */
function membershipHeaders(path: string | null): Map<string, string> {
  const map = new Map<string, string>()
  if (!path)
    return map
  const text = readFileSync(path, 'utf8')
  for (const line of text.split('\n')) {
    if (!line.includes('liveChatMembershipItemRenderer'))
      continue
    try {
      const row = JSON.parse(line) as {
        replayChatItemAction?: { actions?: { addChatItemAction?: { item?: { liveChatMembershipItemRenderer?: { timestampUsec?: string, headerSubtext?: { runs?: { text?: string }[] } } } } }[] }
      }
      for (const action of row.replayChatItemAction?.actions ?? []) {
        const item = action.addChatItemAction?.item?.liveChatMembershipItemRenderer
        if (!item?.timestampUsec)
          continue
        const header = (item.headerSubtext?.runs ?? []).map(run => run.text ?? '').join('').trim()
        if (header)
          map.set(item.timestampUsec, header)
      }
    }
    catch {
      continue
    }
  }
  return map
}

const SEGMENTER = new Intl.Segmenter('ja', { granularity: 'word' })
const INFORMATIVE_RE = /[\p{Script=Han}\p{Script=Katakana}A-Za-z]/u
/** 频道专属表情的落库写法（`emoji.id` 含 `/`）在清洗版里记作 `[表情]`。 */
const CHANNEL_EMOJI_RE = /\[表情(?:×\d+)?\]/g

/** 与 danmaku 渲染口径一致：只剩频道表情的一条算「纯表情」。 */
function isEmojiOnly(msg: ChatMsg): boolean {
  const content = (msg.text ?? '').replace(/\r?\n/g, ' ')
  const tokens = (msg.emoji ?? []).map(e => (e.id.includes('/') ? '[表情]' : e.id)).join('')
  const body = `${content}${tokens}`.trim()
  return body.length > 0 && body.replace(CHANNEL_EMOJI_RE, '') === ''
}

/**
 * 弹幕里值得看的词：汉字・片假名・拉丁词，以及够长的平假名词（「ありがとう」「かわいい」）。
 * 太短的平假名几乎全是助词・语尾，留着只会把榜单挤满。
 */
function countWords(texts: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const text of texts) {
    for (const seg of SEGMENTER.segment(text)) {
      const word = seg.segment.trim()
      if (!seg.isWordLike || word.length < 2)
        continue
      const informative = INFORMATIVE_RE.test(word) || word.length >= 4
      if (!informative)
        continue
      if (isNoiseWord(word))
        continue
      if (isStopword(word))
        continue
      const key = canonicalWord(word)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

/** 赠送/领取的系统文案不是观众发言，计入词频会把榜单刷满 `gift` / `membership`。 */
function isSystemChat(kind: string | undefined): boolean {
  return kind === 'gift' || kind === 'giftRedemption'
}

/** v1 的 Top 列表：从全量词频里取 ≥3 次的前 40 个，单场页直接用。 */
function topWords(counts: Map<string, number>, limit = 40): { word: string, count: number }[] {
  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }))
}

function buildPack(sessionDir: string, vstatsOverride: string | null, sources: DatasetSource[]) {
  const info = readJson<InfoJson>(join(sessionDir, 'meta', 'info.json'))
  if (!info?.id)
    throw new Error(`找不到 meta/info.json 或缺少 id：${sessionDir}`)
  const videoId = info.id

  const danmakuPath = pick(join(sessionDir, 'danmaku'), new RegExp(`^danmaku_${videoId}\\.jsonl$`))
    ?? pick(join(sessionDir, 'danmaku'), ANY_DANMAKU_RE)
  const rawChatPath = pick(join(sessionDir, 'danmaku'), new RegExp(`^${videoId}\\.live_chat\\.json$`))
  const emojiPath = pick(join(sessionDir, 'danmaku'), new RegExp(`^emoji_${videoId}\\.json$`))
  const eventsPath = pick(join(sessionDir, 'danmaku'), new RegExp(`^events_${videoId}\\.jsonl$`))
  const commentsPath = pick(join(sessionDir, 'comments'), new RegExp(`^comments_${videoId}\\.json$`))
  const vstatsPath = vstatsOverride
    ?? pick(join(sessionDir, 'web'), new RegExp(`^vstats_video_${videoId}\\.html$`))

  const startedSec = info.release_timestamp ?? info.timestamp ?? null
  const durationSec = info.duration ?? null
  const endedSec = startedSec != null && durationSec != null ? startedSec + durationSec : null

  const records: ChatRecord[] = (danmakuPath ? readFileSync(danmakuPath, 'utf8') : '')
    .split('\n')
    .filter(line => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line) as ChatRecord
      }
      catch {
        return null
      }
    })
    .filter((r): r is ChatRecord => r != null && !!r.msg)

  const timed = records
    .map(record => ({ record, at: chatTimestamp(record) }))
    .filter((entry): entry is { record: ChatRecord, at: number } => entry.at != null)
    .sort((a, b) => a.at - b.at)

  const memberChats = collectMemberChats(timed, memberChannelMap(sources, info.channel_id ?? null))

  const byKind = { text: 0, superchat: 0, sticker: 0, membership: 0, gift: 0 }
  // 按稳定 ID 去重；没有 ID 的旧数据退回显示名。显示名会改、会重名，不能当主键。
  const authors = new Map<string, {
    author: string
    authorId: string | null
    messages: number
    superchats: number
    stickers: number
    memberships: number
    badges: Set<string>
  }>()
  const badges = new Map<string, number>()
  const emoji = new Map<string, number>()
  const scList: { at: string, author: string, amountText: string, currency: string, amount: number, message: string, emojis?: string[] }[] = []
  const stickerList: { at: string, author: string, amountText: string, currency: string, amount: number }[] = []
  const scTotals = new Map<string, { count: number, amount: number }>()
  const stickerTotals = new Map<string, { count: number, amount: number }>()
  const emojiAssets = (emojiPath ? readJson<{ emojis?: EmojiAsset[] }>(emojiPath)?.emojis ?? [] : [])
    .filter(asset => asset?.id && asset.url)
  const headers = membershipHeaders(rawChatPath)
  const membershipList: { at: string, author: string, header: string | null }[] = []
  const giftList: { at: string, author: string, count: number, text: string }[] = []
  let pureEmoji = 0
  let ownerMessages = 0
  // 主播本人发言单独存一份：徽章 Owner 只统计次数，明细要全量留给页面展示。
  const ownerChats: { at: string, kind: string, text: string, emojis?: string[] }[] = []
  /** 已经作为主播发言入库的 rendererId：置顶事件不再重复一条。 */
  const ownerRecordIds = new Set<string>()

  for (const { record, at } of timed) {
    const rawKind = record.msg.kind ?? 'text'
    // 领取赠礼也是一次会员事件，并入 membership；赠送方的一次购买单独记 gift。
    const kind = rawKind === 'giftRedemption' ? 'membership' : rawKind
    if (kind in byKind)
      byKind[kind as keyof typeof byKind] += 1

    const author = record.msg.author ?? '(unknown)'
    const authorKey = record.msg.authorId ? `id:${record.msg.authorId}` : `name:${author}`
    const entry = authors.get(authorKey) ?? {
      author,
      authorId: record.msg.authorId ?? null,
      messages: 0,
      superchats: 0,
      stickers: 0,
      memberships: 0,
      badges: new Set<string>(),
    }
    entry.author = author
    entry.messages += 1
    if (kind === 'superchat')
      entry.superchats += 1
    if (kind === 'sticker')
      entry.stickers += 1
    if (kind === 'membership')
      entry.memberships += 1
    for (const badge of record.msg.badges ?? []) {
      badges.set(badge, (badges.get(badge) ?? 0) + 1)
      entry.badges.add(badge)
      if (badge === 'Owner')
        ownerMessages += 1
    }
    authors.set(authorKey, entry)

    const text = record.msg.text ?? ''
    if ((record.msg.badges ?? []).includes('Owner')) {
      if (record.rendererId)
        ownerRecordIds.add(record.rendererId)
      const emojiIds = record.msg.emoji?.map(item => item.id) ?? []
      ownerChats.push({
        at: jstIso(at),
        kind,
        text: text.trim() || record.msg.header?.trim() || '',
        ...(emojiIds.length ? { emojis: emojiIds } : {}),
      })
    }
    if (isEmojiOnly(record.msg))
      pureEmoji += 1
    for (const e of record.msg.emoji ?? [])
      emoji.set(e.id, (emoji.get(e.id) ?? 0) + 1)

    const parsed = parseAmount(record.msg.sc)
    if (kind === 'superchat' && parsed) {
      const emojiIds = record.msg.emoji?.map(item => item.id) ?? []
      scList.push({
        at: jstIso(at),
        author,
        amountText: record.msg.sc ?? '',
        currency: parsed.currency,
        amount: parsed.amount,
        message: text,
        ...(emojiIds.length ? { emojis: emojiIds } : {}),
      })
      const total = scTotals.get(parsed.currency) ?? { count: 0, amount: 0 }
      total.count += 1
      total.amount += parsed.amount
      scTotals.set(parsed.currency, total)
    }
    if (kind === 'sticker' && parsed) {
      stickerList.push({ at: jstIso(at), author, amountText: record.msg.sc ?? '', currency: parsed.currency, amount: parsed.amount })
      const total = stickerTotals.get(parsed.currency) ?? { count: 0, amount: 0 }
      total.count += 1
      total.amount += parsed.amount
      stickerTotals.set(parsed.currency, total)
    }
    if (kind === 'membership') {
      // 领取赠礼的文案就在归一化弹幕里（`received a gift membership by …`）。
      // 自己入会/续费的文案优先用 jsonl 里的 `msg.header`，旧 jsonl 才回退原始回放。
      const raw = record.msg.timestampUs
      const header = rawKind === 'giftRedemption'
        ? text.trim() || null
        : record.msg.header?.trim() || (raw != null ? headers.get(String(raw)) ?? null : null)
      membershipList.push({ at: jstIso(at), author, header })
    }
    if (rawKind === 'gift')
      giftList.push({ at: jstIso(at), author, count: record.msg.giftCount ?? 0, text })
  }

  const firstAt = timed[0]?.at ?? null
  const lastAt = timed.at(-1)?.at ?? null
  const coveredFrom = startedSec != null && firstAt != null ? Math.max(firstAt, startedSec) : firstAt
  const preRollSec = startedSec != null && firstAt != null ? Math.round(startedSec - firstAt) : null
  const minutes = durationSec != null ? Math.ceil(durationSec / 60) : 0
  const perMinute = Array.from<number>({ length: Math.max(minutes, 1) }).fill(0)
  const perMinuteSc = Array.from<number>({ length: Math.max(minutes, 1) }).fill(0)
  if (startedSec != null) {
    for (const { record, at } of timed) {
      const index = Math.floor((at - startedSec) / 60)
      if (index < 0 || index >= perMinute.length)
        continue
      perMinute[index] = (perMinute[index] ?? 0) + 1
      if ((record.msg.kind ?? 'text') === 'superchat')
        perMinuteSc[index] = (perMinuteSc[index] ?? 0) + 1
    }
  }

  const perFiveMinute = Array.from({ length: Math.ceil(perMinute.length / 5) }, (_, i) =>
    perMinute.slice(i * 5, i * 5 + 5).reduce((sum, n) => sum + n, 0))
  const perTenMinute = Array.from({ length: Math.ceil(perMinute.length / 10) }, (_, i) => ({
    offsetMin: i * 10,
    at: startedSec != null ? jstIso(startedSec + i * 600) : null,
    messages: perMinute.slice(i * 10, i * 10 + 10).reduce((sum, n) => sum + n, 0),
    superchats: perMinuteSc.slice(i * 10, i * 10 + 10).reduce((sum, n) => sum + n, 0),
  }))

  const peakIndex = perMinute.reduce((best, count, i) => (count > (perMinute[best] ?? 0) ? i : best), 0)

  const authorList = [...authors.values()].sort((a, b) => b.messages - a.messages)
  const topAuthors = authorList.slice(0, 20).map(entry => ({
    author: entry.author,
    authorId: entry.authorId,
    messages: entry.messages,
    superchats: entry.superchats,
    stickers: entry.stickers,
    memberships: entry.memberships,
    badges: [...entry.badges],
  }))
  // v2 全量作者：跨场精确聚合与观众重叠都靠它，不再被 Top 20 截断。
  const authorStats = authorList.map(entry => ({
    author: entry.author,
    authorId: entry.authorId,
    messages: entry.messages,
    superchats: entry.superchats,
    stickers: entry.stickers,
    memberships: entry.memberships,
  }))

  const wordCounts = countWords(
    timed
      .filter(({ record }) => !isSystemChat(record.msg.kind))
      .map(({ record }) => record.msg.text ?? ''),
  )
  // 先按次数、再按词排序：同样的输入每次产出同样的 JSON，方便比对 diff。
  const wordCountPayload = Object.fromEntries(
    [...wordCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  )

  const hashtags = new Map<string, number>()
  for (const { record } of timed) {
    for (const tag of (record.msg.text ?? '').match(/[#＃][^\s#＃]+/g) ?? [])
      hashtags.set(tag, (hashtags.get(tag) ?? 0) + 1)
  }

  const comments = commentsPath ? readJson<CommentJson>(commentsPath) : null
  const commentRows = (comments?.comments ?? []).filter(row => row.parent === 'root' || row.parent == null)
  const replies = (comments?.comments ?? []).filter(row => row.parent != null && row.parent !== 'root')

  const vstats = vstatsPath && existsSync(vstatsPath) ? parseVstats(readFileSync(vstatsPath, 'utf8')) : null

  const rawEvents: RawChatEvent[] = eventsPath
    ? readFileSync(eventsPath, 'utf8')
        .split('\n')
        .filter(line => line.trim())
        .map((line) => {
          try {
            return JSON.parse(line) as RawChatEvent
          }
          catch {
            return null
          }
        })
        .filter((row): row is RawChatEvent => row != null)
    : []

  // 投票更新只覆盖同一条 poll 的 choices，最终票数进 data；事件本身保留首次出现的位置。
  const chatEvents: PackChatEvent[] = []
  const pollIndex = new Map<string, number>()
  for (const raw of rawEvents) {
    if (typeof raw.at !== 'number' || typeof raw.type !== 'string')
      continue
    const event: PackChatEvent = {
      at: jstIso(raw.at),
      type: raw.type,
      owner: raw.owner === true,
      ...(raw.author ? { author: raw.author } : {}),
      ...(raw.authorId ? { authorId: raw.authorId } : {}),
      text: typeof raw.text === 'string' ? raw.text : null,
      ...(raw.data && typeof raw.data === 'object' ? { data: raw.data } : {}),
    }
    if (raw.type === 'poll' || raw.type === 'pollUpdate') {
      const key = typeof raw.data?.pollKey === 'string' ? raw.data.pollKey : raw.id ?? ''
      const existingIndex = pollIndex.get(key)
      if (existingIndex != null) {
        const existing = chatEvents[existingIndex]
        if (existing) {
          existing.data = { ...(existing.data ?? {}), ...(raw.data ?? {}), updatedAt: event.at }
          existing.text = existing.text ?? event.text
        }
        continue
      }
      pollIndex.set(key, chatEvents.length)
    }
    chatEvents.push(event)
  }

  // 主播操作（置顶 / 投票 / Q&A / 商品 / 被删消息）并入 ownerChats，?view=words 直接可见。
  for (const event of chatEvents) {
    if (!event.owner)
      continue
    if (event.type === 'banner' && typeof event.data?.targetId === 'string' && ownerRecordIds.has(event.data.targetId))
      continue
    let text = event.text
    if (!text && event.type === 'deleted' && typeof event.data?.targetText === 'string')
      text = `[已删除] ${event.data.targetText}`
    if (!text)
      continue
    const pinned = event.data?.pinnedEmojis
    const pinnedEmojis = Array.isArray(pinned)
      ? pinned.filter((id): id is string => typeof id === 'string')
      : []
    ownerChats.push({
      at: event.at,
      kind: 'event',
      text,
      ...(pinnedEmojis.length ? { emojis: pinnedEmojis } : {}),
    })
  }
  // 消息按时间、事件按 at；合并后统一排序，避免主播事件排在最后。
  ownerChats.sort((a, b) => a.at.localeCompare(b.at))

  const pack = {
    schema: SCHEMA,
    generatedAt: jstIso(Date.now() / 1000),
    video: {
      id: videoId,
      url: info.webpage_url ?? `https://www.youtube.com/watch?v=${videoId}`,
      title: info.title ?? null,
      channelId: info.channel_id ?? null,
      channelName: info.channel ?? null,
      channelUrl: info.channel_url ?? null,
      channelFollowersAtCapture: info.channel_follower_count ?? null,
      liveStatus: info.live_status ?? null,
      availability: info.availability ?? null,
      startedAt: startedSec != null ? jstIso(startedSec) : null,
      publishedAt: info.timestamp != null ? jstIso(info.timestamp) : null,
      durationSec,
      durationHms: durationSec != null ? hms(durationSec) : null,
      endedAt: endedSec != null ? jstIso(endedSec) : null,
      thumbnail: info.thumbnail ?? null,
      description: info.description ?? null,
      links: [...new Set((info.description ?? '').match(/https?:\/\/[^\s)>]+/g) ?? [])],
      chapters: (info.chapters ?? []).filter(Boolean),
      hasLiveChatReplay: !!(info.subtitles && 'live_chat' in info.subtitles),
      captionsJa: !!(info.automatic_captions && ('ja' in info.automatic_captions || 'ja-orig' in info.automatic_captions)),
      snapshot: {
        views: info.view_count ?? null,
        likes: info.like_count ?? null,
        comments: info.comment_count ?? null,
      },
    },
    vstats,
    chat: {
      total: timed.length,
      byKind,
      pureEmojiOnly: pureEmoji,
      uniqueAuthors: authors.size,
      ownerMessages,
      badges: Object.fromEntries([...badges.entries()].sort((a, b) => b[1] - a[1])),
      timeRange: { firstAt: firstAt != null ? jstIso(firstAt) : null, lastAt: lastAt != null ? jstIso(lastAt) : null, preRollSec },
      coveragePct: durationSec && coveredFrom != null && lastAt != null
        ? round(((lastAt - coveredFrom) / durationSec) * 100, 1)
        : null,
      density: {
        perMinuteMean: durationSec ? round(timed.length / (durationSec / 60), 2) : null,
        peakMinute: peakIndex > 0 || (perMinute[0] ?? 0) > 0 ? { offsetMin: peakIndex, at: startedSec != null ? jstIso(startedSec + peakIndex * 60) : null, count: perMinute[peakIndex] ?? 0 } : null,
        perMinute,
        perMinuteSc,
        perFiveMinute,
        perTenMinute,
      },
      paid: {
        superchats: scList,
        scTotalsByCurrency: Object.fromEntries([...scTotals.entries()]),
        stickers: stickerList,
        stickerTotalsByCurrency: Object.fromEntries([...stickerTotals.entries()]),
        memberships: membershipList,
        gifts: giftList,
        paidSharePct: timed.length
          ? round(((scList.length + stickerList.length + membershipList.length + giftList.length) / timed.length) * 100, 1)
          : null,
      },
      topAuthors,
      authors: authorStats,
      topWords: topWords(wordCounts),
      wordCounts: wordCountPayload,
      hashtags: Object.fromEntries([...hashtags.entries()].sort((a, b) => b[1] - a[1])),
      emojiKinds: { distinct: emoji.size, top: [...emoji.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([id, count]) => ({ id, count })) },
      ...(emojiAssets.length ? { emojis: emojiAssets } : {}),
      ...(ownerChats.length ? { ownerChats } : {}),
      ...(memberChats.length ? { memberChats } : {}),
      ...(chatEvents.length ? { events: chatEvents } : {}),
    },
    comments: comments
      ? {
          total: commentRows.length + replies.length,
          topLevel: commentRows.length,
          replies: replies.length,
          pinned: commentRows.filter(row => row.is_pinned).length,
          totalLikes: commentRows.reduce((sum, row) => sum + (row.like_count ?? 0), 0),
          items: commentRows
            .sort((a, b) => (b.like_count ?? 0) - (a.like_count ?? 0))
            .map(row => ({
              author: row.author ?? null,
              authorId: row.author_id ?? null,
              likes: row.like_count ?? 0,
              at: row.timestamp != null ? jstIso(row.timestamp) : null,
              pinned: !!row.is_pinned,
              byUploader: !!row.author_is_uploader,
              text: row.text ?? '',
            })),
        }
      : null,
    derived: {
      // 每 1000 名平均同接对应的弹幕条数 / 点赞率 / 两边播放数差，口径见 scripts/lib/vstats.ts。
      ...deriveVstats(vstats, timed.length, info.view_count ?? null),
      scPerHour: startedSec && lastAt != null && scList.length
        ? round(scList.length / ((lastAt - startedSec) / 3600), 2)
        : null,
    },
  }

  return {
    pack,
    channelId: info.channel_id ?? null,
    stats: { chat: timed.length, authors: authors.size, sc: scList.length, comments: commentRows.length },
  }
}

/**
 * 把一个或多个会话目录归一化成 datapack。
 *
 * 进程内可调用（`data fetch` 用它替代 spawn）：位置参数从 `sessions` 传，
 * 不读 process.argv、不调用 process.exit；单个会话失败只记录，其余继续。
 */
export function runDatapack(options: RunDatapackOptions): { exitCode: number, data?: DatapackRunResult } {
  const log = options.log ?? SILENT_LOG
  const sessions = options.sessions ?? []
  if (sessions.length === 0) {
    throw new UsageError('至少需要一个会话目录', {
      hint: '例如 bun run ymmt data datapack temp/youtube-live/2024-01-01_nonoka_abcdefghijk',
    })
  }
  if (sessions.length > 1 && (options.out || options.vstats)) {
    throw new UsageError('--out / --vstats 只能用于单个会话', {
      hint: '一次只处理一个会话目录，或去掉 --out / --vstats',
      context: { sessions: sessions.length },
    })
  }

  const sources = readDatasources()
  const vstatsOverride = options.vstats ? resolve(options.vstats) : null
  const written: DatapackSessionResult[] = []
  const failures: { session: string, error: string }[] = []

  for (const positional of sessions) {
    const sessionDir = resolve(positional)
    try {
      const { pack, channelId, stats } = buildPack(sessionDir, vstatsOverride, sources)
      const dataset = resolveDataset(sources, channelId, options.dataset)
      if (options.dataset && !dataset)
        throw new Error(`data-sources.json 里没有 dataset：${options.dataset}`)

      const usingExplicitOut = Boolean(options.out)
      const outPath = options.out
        ? resolve(options.out)
        : dataset
          ? join(APP_ROOT, dataset.datapackDir, `${pack.video.id}.datapack.json`)
          : join(sessionDir, 'work', 'stream-datapack.json')

      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8')

      const datapackRel = relative(APP_ROOT, outPath).replaceAll('\\', '/')
      log.info(datapackRel)
      log.info(`弹幕 ${stats.chat} 条 / 作者 ${stats.authors} 人 / SC ${stats.sc} 笔 / 评论 ${stats.comments} 条`)

      let manifestCount: number | null = null
      if (!dataset) {
        log.warn('未匹配 data-sources.json 的 dataset，只写到会话目录')
      }
      else if (!usingExplicitOut && !options.skipIndex) {
        const manifestPath = resolve(APP_ROOT, dataset.manifest)
        const { count } = upsertManifestStream(manifestPath, pack, datapackRel)
        manifestCount = count
        log.info(`manifest ${dataset.id}: ${count} 场`)
      }

      written.push({
        session: sessionDir,
        videoId: pack.video.id,
        datasetId: dataset?.id ?? null,
        outPath,
        rel: datapackRel,
        manifestCount,
        stats,
      })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ session: sessionDir, error: message })
      log.error(`失败 ${sessionDir}：${message}`)
    }
  }

  return { exitCode: failures.length > 0 ? 1 : 0, data: { written, failures } }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** `data datapack`：把一场素材合并成 datapack。 */
export const dataDatapackSpec: CommandSpec<DatapackRunResult> = {
  id: 'data.datapack',
  description: '把会话目录的元信息・弹幕・评论・VSTATS 合并成 datapack',
  details: '把一场或多场直播的元信息・弹幕・评论区・VSTATS 快照归一化成 datapack。\n'
    + '按 info.channel_id 匹配 data-sources.json 的 dataset，写到 '
    + 'data/<datasetId>/<videoId>.datapack.json，并 upsert manifest 摘要。\n'
    + '匹配不到 dataset 时只写到 <会话目录>/work/stream-datapack.json。',
  examples: [
    'bun run ymmt data datapack temp/youtube-live/2024-01-01_nonoka_abcdefghijk',
    'bun run ymmt data datapack temp/youtube-live/session-a temp/youtube-live/session-b --dataset nonoka',
    'bun run ymmt data datapack temp/youtube-live/session-a --out temp/pack.json --json',
  ],
  arguments: [
    // 名字带 `...` 才会注册成 commander 的可变长位置参数（`<sessions...>`）。
    { name: 'sessions...', description: '会话目录（可多个）', required: true },
  ],
  options: [
    new Option('--dataset <id>', '强制指定 dataset（默认按 channelId 匹配）'),
    new Option('--out <路径>', '输出到指定文件（仅单个会话；不更新 manifest）'),
    new Option('--vstats <路径>', 'VSTATS 单场页 HTML（仅单个会话，默认自动找 web/vstats_video_<id>.html）'),
    new Option('--skip-index', '只写 datapack，不更新 manifest'),
  ],
  run(ctx) {
    const result = runDatapack({
      sessions: ctx.args,
      dataset: optionalString(ctx.options.dataset),
      out: optionalString(ctx.options.out),
      vstats: optionalString(ctx.options.vstats),
      skipIndex: ctx.flag('skipIndex'),
      log: ctx.log,
    })
    return Promise.resolve({ exitCode: result.exitCode, data: result.data })
  },
}
