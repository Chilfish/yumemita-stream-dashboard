#!/usr/bin/env bun
/**
 * 一场直播的「数据包」：把 yt-dlp 的元信息・弹幕・评论区，与 VSTATS 的统计快照
 * 合并成一份归一化 JSON，供后续统计/画图/复用。
 *
 *   bun scripts/stream-datapack.ts <会话目录...>
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
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { upsertManifestStream } from './lib/dataset-manifest.ts'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATASOURCES_PATH = join(APP_ROOT, 'data-sources.json')

const SCHEMA = 'yumemita.stream-datapack/v2'
const JST_OFFSET_MIN = 540
const ANY_DANMAKU_RE = /^danmaku_.*\.jsonl$/

interface ChatMsg {
  author?: string
  /** 稳定的频道 ID；旧 jsonl 没有这个字段。 */
  authorId?: string
  text?: string
  sc?: string | null
  kind?: string
  badges?: string[]
  emoji?: { id: string }[]
  timestampUs?: string | number
}

interface ChatRecord {
  seq?: number
  ts?: number
  msg: ChatMsg
}

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

interface VstatsVideo {
  updatedAt: string | null
  startedAt: string | null
  endedAt: string | null
  durationText: string | null
  maxConcurrent: number | null
  maxConcurrentAt: string | null
  avgConcurrent: number | null
  watchTimeHours: number | null
  views: number | null
  likes: number | null
}

interface DatasetSource {
  id: string
  label: string
  channelId?: string
  manifest: string
  datapackDir: string
}

const OPTIONS = {
  out: { type: 'string' },
  vstats: { type: 'string' },
  dataset: { type: 'string' },
  'skip-index': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const

const USAGE = `用法：bun scripts/stream-datapack.ts <会话目录...> [选项]

把一场或多场直播的元信息・弹幕・评论区・VSTATS 快照归一化成 datapack。

按 info.channel_id 匹配 data-sources.json 的 dataset，写到
data/<datasetId>/<videoId>.datapack.json，并 upsert manifest 摘要。

选项：
  --dataset <id>    强制指定 dataset（默认按 channelId 匹配）
  --out <路径>      输出到指定文件（仅单个会话；不更新 manifest）
  --vstats <路径>   VSTATS 单场页 HTML（仅单个会话，默认自动找 web/vstats_video_<id>.html）
  --skip-index      只写 datapack，不更新 manifest
  -h, --help        显示本帮助`

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

function jstIso(seconds: number): string {
  const d = new Date((seconds + JST_OFFSET_MIN * 60) * 1000)
  return `${d.toISOString().slice(0, 19)}+09:00`
}

function hms(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function num(text: string | undefined): number | null {
  if (!text)
    return null
  const n = Number(text.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
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

/** VSTATS 单场页是服务端渲染的固定版式：按标签取其后的一小段再抠值。 */
function vstatsBlock(html: string, label: string, length = 700): string | null {
  const i = html.indexOf(label)
  return i < 0 ? null : html.slice(i, i + length)
}

const UPDATED_AT_RE = /最終更新:\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/
const DATE_RE = /(\d{4}-\d{2}-\d{2})/
const TIME_RE = /(\d{2}:\d{2}:\d{2})/
const STAT_DURATION_RE = /(\d+:\d{2}:\d{2})/
const STAT_NUMBER_RE = /<span class="fs-5[^"]*">\s*([\d,]+)/
const MAX_CONCURRENT_AT_RE = /\((\d{1,2}\/\d{1,2} \d{2}:\d{2})\)/

function parseVstats(html: string): VstatsVideo {
  // 「最大視聴者数ランキング」「高評価数ランキング」这类导航词在页首，先跳到统计块再取标签。
  const detail = html.slice(Math.max(0, html.indexOf('最終更新')))
  const started = vstatsBlock(detail, '開始時刻')
  const ended = vstatsBlock(detail, '終了時刻')
  const duration = vstatsBlock(detail, '配信時間', 300)
  const maxBlock = vstatsBlock(detail, '最大視聴者数')
  const avgBlock = vstatsBlock(detail, '平均視聴者数', 400)
  const watchBlock = vstatsBlock(detail, '視聴時間', 400)
  const viewBlock = vstatsBlock(detail, '再生数', 400)
  const likeBlock = vstatsBlock(detail, '高評価数', 400)

  const stamp = (block: string | null): string | null => {
    if (!block)
      return null
    const date = DATE_RE.exec(block)?.[1]
    const time = TIME_RE.exec(block)?.[1]
    return date && time ? `${date}T${time}+09:00` : null
  }

  return {
    updatedAt: UPDATED_AT_RE.exec(html)?.[1] ?? null,
    startedAt: stamp(started),
    endedAt: stamp(ended),
    durationText: STAT_DURATION_RE.exec(duration ?? '')?.[1] ?? null,
    maxConcurrent: num(STAT_NUMBER_RE.exec(maxBlock ?? '')?.[1]),
    maxConcurrentAt: MAX_CONCURRENT_AT_RE.exec(maxBlock ?? '')?.[1] ?? null,
    avgConcurrent: num(STAT_NUMBER_RE.exec(avgBlock ?? '')?.[1]),
    watchTimeHours: num(STAT_NUMBER_RE.exec(watchBlock ?? '')?.[1]),
    views: num(STAT_NUMBER_RE.exec(viewBlock ?? '')?.[1]),
    likes: num(STAT_NUMBER_RE.exec(likeBlock ?? '')?.[1]),
  }
}

const AMOUNT_RE = /^([¥₩$€£]|HK\$|NT\$|A\$|C\$)\s*([\d,]+(?:\.\d+)?)$/
const AMOUNT_SEPARATOR_RE = /,/g

function parseAmount(text: string | null | undefined): { currency: string, amount: number } | null {
  if (!text)
    return null
  const m = AMOUNT_RE.exec(text.trim())
  const currency = m?.[1]
  const raw = m?.[2]
  if (!currency || !raw)
    return null
  return { currency, amount: Number(raw.replace(AMOUNT_SEPARATOR_RE, '')) }
}

function chatTimestamp(record: ChatRecord): number | null {
  const us = record.msg.timestampUs
  if (us != null) {
    const n = Number(us) / 1_000_000
    if (Number.isFinite(n))
      return n
  }
  return typeof record.ts === 'number' ? record.ts : null
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
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
  }
  return counts
}

/** v1 的 Top 列表：从全量词频里取 ≥3 次的前 40 个，单场页直接用。 */
function topWords(counts: Map<string, number>, limit = 40): { word: string, count: number }[] {
  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }))
}

function buildPack(sessionDir: string, vstatsOverride: string | null) {
  const info = readJson<InfoJson>(join(sessionDir, 'meta', 'info.json'))
  if (!info?.id)
    throw new Error(`找不到 meta/info.json 或缺少 id：${sessionDir}`)
  const videoId = info.id

  const danmakuPath = pick(join(sessionDir, 'danmaku'), new RegExp(`^danmaku_${videoId}\\.jsonl$`))
    ?? pick(join(sessionDir, 'danmaku'), ANY_DANMAKU_RE)
  const rawChatPath = pick(join(sessionDir, 'danmaku'), new RegExp(`^${videoId}\\.live_chat\\.json$`))
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

  const byKind = { text: 0, superchat: 0, sticker: 0, membership: 0 }
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
  const scList: { at: string, author: string, amountText: string, currency: string, amount: number, message: string }[] = []
  const stickerList: { at: string, author: string, amountText: string, currency: string, amount: number }[] = []
  const scTotals = new Map<string, { count: number, amount: number }>()
  const stickerTotals = new Map<string, { count: number, amount: number }>()
  const headers = membershipHeaders(rawChatPath)
  const membershipList: { at: string, author: string, header: string | null }[] = []
  let pureEmoji = 0
  let ownerMessages = 0

  for (const { record, at } of timed) {
    const kind = (record.msg.kind ?? 'text') as keyof typeof byKind
    if (kind in byKind)
      byKind[kind] += 1

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
    if (isEmojiOnly(record.msg))
      pureEmoji += 1
    for (const e of record.msg.emoji ?? [])
      emoji.set(e.id, (emoji.get(e.id) ?? 0) + 1)

    const parsed = parseAmount(record.msg.sc)
    if (kind === 'superchat' && parsed) {
      scList.push({ at: jstIso(at), author, amountText: record.msg.sc ?? '', currency: parsed.currency, amount: parsed.amount, message: text })
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
      const raw = record.msg.timestampUs
      membershipList.push({ at: jstIso(at), author, header: raw != null ? headers.get(String(raw)) ?? null : null })
    }
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

  const wordCounts = countWords(timed.map(({ record }) => record.msg.text ?? ''))
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
        paidSharePct: timed.length ? round(((scList.length + stickerList.length + membershipList.length) / timed.length) * 100, 1) : null,
      },
      topAuthors,
      authors: authorStats,
      topWords: topWords(wordCounts),
      wordCounts: wordCountPayload,
      hashtags: Object.fromEntries([...hashtags.entries()].sort((a, b) => b[1] - a[1])),
      emojiKinds: { distinct: emoji.size, top: [...emoji.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([id, count]) => ({ id, count })) },
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
      /** 每 1000 名平均同接对应的弹幕条数——跨场次比较「弹幕热不热」的量。 */
      chatPer1000AvgViewers: vstats?.avgConcurrent && timed.length
        ? round((timed.length / vstats.avgConcurrent) * 1000, 1)
        : null,
      likesPer1000Views: vstats?.views && vstats.likes
        ? round((vstats.likes / vstats.views) * 1000, 1)
        : null,
      scPerHour: startedSec && lastAt != null && scList.length
        ? round(scList.length / ((lastAt - startedSec) / 3600), 2)
        : null,
      /** 同一时间点两边的播放数差（VSTATS 快照 vs 抓取时）。 */
      vstatsVsYtdlpViews: vstats?.views != null && info.view_count != null ? info.view_count - vstats.views : null,
    },
  }

  return {
    pack,
    channelId: info.channel_id ?? null,
    stats: { chat: timed.length, authors: authors.size, sc: scList.length, comments: commentRows.length },
  }
}

function main(): void {
  const { values, positionals } = parseArgs({ options: OPTIONS, args: process.argv.slice(2), allowPositionals: true })
  if (values.help || positionals.length === 0) {
    console.log(USAGE)
    process.exit(values.help ? 0 : 1)
  }
  if (positionals.length > 1 && (values.out || values.vstats)) {
    console.error('[stream-datapack] --out / --vstats 只能用于单个会话')
    process.exit(1)
  }

  const sources = readDatasources()
  const vstatsOverride = values.vstats ? resolve(values.vstats) : null
  let failed = 0

  for (const positional of positionals) {
    const sessionDir = resolve(positional)
    try {
      const { pack, channelId, stats } = buildPack(sessionDir, vstatsOverride)
      const dataset = resolveDataset(sources, channelId, values.dataset)
      if (values.dataset && !dataset)
        throw new Error(`data-sources.json 里没有 dataset：${values.dataset}`)

      const usingExplicitOut = Boolean(values.out)
      const outPath = values.out
        ? resolve(values.out)
        : dataset
          ? join(APP_ROOT, dataset.datapackDir, `${pack.video.id}.datapack.json`)
          : join(sessionDir, 'work', 'stream-datapack.json')

      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8')

      const datapackRel = relative(APP_ROOT, outPath).replaceAll('\\', '/')
      console.log(`[stream-datapack] ${datapackRel}`)
      console.log(`[stream-datapack] 弹幕 ${stats.chat} 条 / 作者 ${stats.authors} 人 / SC ${stats.sc} 笔 / 评论 ${stats.comments} 条`)

      if (!dataset) {
        console.warn('[stream-datapack] 未匹配 data-sources.json 的 dataset，只写到会话目录')
      }
      else if (!usingExplicitOut && !values['skip-index']) {
        const manifestPath = resolve(APP_ROOT, dataset.manifest)
        const { count } = upsertManifestStream(manifestPath, pack, datapackRel)
        console.log(`[stream-datapack] manifest ${dataset.id}: ${count} 场`)
      }
    }
    catch (error) {
      failed += 1
      console.error(`[stream-datapack] 失败 ${sessionDir}：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (failed > 0)
    process.exit(1)
}

main()
