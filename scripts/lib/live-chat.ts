/**
 * yt-dlp `live_chat` 原始档 → datapack 脚本吃的 NDJSON。
 *
 *   yt-dlp --cookies-from-browser firefox --skip-download --write-subs \
 *     --sub-langs live_chat -o "danmaku/%(id)s.%(ext)s" <URL>
 *   bun scripts/lib/live-chat.ts danmaku/<videoId>.live_chat.json
 *
 * 输出同目录的 `danmaku_<videoId>.jsonl`：`{ seq, video, ts, msg }`，字段与
 * 归档工程的 `scripts/danmaku/from-live-chat.ts` 保持一致。
 */
import { createWriteStream, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

/** 赠送会员公告的作者/文案在 `header` 里，不在 renderer 顶层。 */
interface SponsorshipsHeader {
  authorName?: { simpleText?: string }
  authorBadges?: BadgeWrapper[]
  primaryText?: { runs?: Run[] }
}

interface Renderer {
  authorName?: { simpleText?: string }
  authorExternalChannelId?: string
  authorBadges?: BadgeWrapper[]
  message?: { runs?: Run[] }
  header?: { liveChatSponsorshipsHeaderRenderer?: SponsorshipsHeader }
  /** 会员留言的主文案（如 `Member for 25 months`）。 */
  headerPrimaryText?: { runs?: Run[]; simpleText?: string }
  /** 会员入会/续费文案或会员自定义状态；普通弹幕没有。 */
  headerSubtext?: { runs?: Run[]; simpleText?: string }
  timestampUsec?: string
  purchaseAmountText?: { simpleText?: string }
  sticker?: {
    thumbnails?: { url?: string, width?: number, height?: number }[]
    accessibility?: { accessibilityData?: { label?: string } }
  }
  // YouTube 把 SC / 贴纸的等级颜色直接写在 renderer 上（ARGB 整数）。
  headerBackgroundColor?: number
  headerTextColor?: number
  bodyBackgroundColor?: number
  bodyTextColor?: number
  authorNameTextColor?: number
  timestampColor?: number
  moneyChipBackgroundColor?: number
  moneyChipTextColor?: number
  backgroundColor?: number
}

interface BadgeWrapper {
  liveChatAuthorBadgeRenderer?: {
    icon?: { iconType?: string }
    tooltip?: string
  }
}

interface RawEmoji {
  emojiId?: string
  shortcuts?: string[]
  isCustomEmoji?: boolean
  image?: {
    thumbnails?: { url?: string, width?: number, height?: number }[]
    accessibility?: { accessibilityData?: { label?: string } }
  }
}

interface Run {
  text?: string
  emoji?: RawEmoji
}

export interface ChatItemWrapper {
  liveChatTextMessageRenderer?: Renderer
  liveChatPaidMessageRenderer?: Renderer
  liveChatPaidStickerRenderer?: Renderer
  liveChatMembershipItemRenderer?: Renderer
  liveChatSponsorshipsGiftPurchaseAnnouncementRenderer?: Renderer
  liveChatSponsorshipsGiftRedemptionAnnouncementRenderer?: Renderer
}

interface RawLine {
  replayChatItemAction?: { actions?: Array<{ addChatItemAction?: { item?: ChatItemWrapper } }> }
}

export interface ChatPaidColors {
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

export interface ChatStickerAsset {
  name: string | null
  url: string
}

export interface ChatRecord {
  seq: number
  video: string
  ts: number
  /**
   * 聊天项 id（`renderer.id`）。实时采集与回放是同一条消息时 id 相同，
   * 合并两份 jsonl 时用它去重；旧档或结构变化时可能缺失。
   */
  rendererId?: string
  msg: {
    author?: string
    /** 稳定的频道 ID（`authorExternalChannelId`）；显示名会改、会重名，重叠分析要用它。 */
    authorId?: string
    text?: string
    sc?: string | null
    kind: 'text' | 'superchat' | 'sticker' | 'membership' | 'gift' | 'giftRedemption'
    timestampUs?: string
    emoji?: { id: string }[]
    badges?: string[]
    /** 会员里程碑文案或会员自定义状态；普通弹幕没有。 */
    header?: string
    /** 会员留言的主文案（`Member for 25 months`）。 */
    membershipPrimary?: string
    /** 会员留言带正文时归为 text，但仍保留会员标记。 */
    memberMessage?: boolean
    /** SC / 贴纸的等级颜色（ARGB 整数）；旧档没有。 */
    colors?: ChatPaidColors
    /** 付费贴纸的图片与无障碍名称；旧档没有。 */
    sticker?: ChatStickerAsset
    /** 一次赠送的会员个数（仅 `kind: 'gift'`）。 */
    giftCount?: number
  }
}

/** 频道专属表情：id 形如 `<channelId>/<hash>`，url 是 InnerTube 给的图片地址。 */
export interface ChatEmoji {
  id: string
  name: string | null
  url: string
}

export const CHAT_EMOJI_SCHEMA = 'yumemita.chat-emoji/v1'

export interface NormalizeResult {
  total: number
  counts: Record<ChatRecord['msg']['kind'], number>
  skipped: number
  /** 被丢弃的 renderer 类型 → 条数；用来发现还没收录的事件类型。 */
  skippedKinds: Record<string, number>
  /** 本场出现过的频道专属表情数（写入 `emoji_<videoId>.json`）。 */
  emojis: number
}

const BADGE_SUFFIX_RE = /\s*\(.*\)\s*$/
const VIDEO_ID_RE = /[A-Za-z0-9_-]{11}/

function badgeNames(wrappers: BadgeWrapper[] | undefined): string[] {
  const names: string[] = []
  for (const wrapper of wrappers ?? []) {
    const badge = wrapper.liveChatAuthorBadgeRenderer
    if (!badge)
      continue
    if (badge.icon?.iconType === 'OWNER') {
      names.push('Owner')
    }
    else if (badge.tooltip) {
      names.push(badge.tooltip.replace(BADGE_SUFFIX_RE, '').trim())
    }
  }
  return names
}

/** 「Sent 50 … gift memberships」里的数量：优先取纯数字的 run，再退回文案里的第一个数字。 */
function giftCountOf(runs: Run[] | undefined, text: string): number | null {
  for (const run of runs ?? []) {
    const match = /^[\d,]+$/.exec((run.text ?? '').trim())
    if (match)
      return Number(match[0].replace(/,/g, ''))
  }
  const fallback = /([\d,]+)/.exec(text)
  return fallback ? Number(fallback[1]!.replace(/,/g, '')) : null
}

/** 只收频道专属表情（Unicode 表情按字符渲染）；取最大尺寸的缩略图。 */
function toEmojiAsset(emoji: RawEmoji): ChatEmoji | null {
  const id = emoji.emojiId
  if (!id || !(emoji.isCustomEmoji || id.includes('/')))
    return null
  const thumbs = [...(emoji.image?.thumbnails ?? [])]
    .filter(thumb => thumb.url)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
  const url = thumbs[0]?.url
  if (!url)
    return null
  const label = emoji.image?.accessibility?.accessibilityData?.label?.trim()
  const shortcut = emoji.shortcuts?.[0]?.replace(/^:/, '').replace(/:$/, '').replace(/^_/, '').trim()
  return { id, name: label || shortcut || null, url }
}

/** `{ simpleText } | { runs[] }` 两种文案形态。 */
function readText(value: { runs?: Run[], simpleText?: string } | undefined): string {
  if (!value)
    return ''
  if (typeof value.simpleText === 'string')
    return value.simpleText.trim()
  return (value.runs ?? []).map(run => run.text ?? '').join('').trim()
}

function readPaidColors(renderer: Renderer): ChatPaidColors | null {
  const entries: [keyof ChatPaidColors, number | undefined][] = [
    ['headerBackground', renderer.headerBackgroundColor],
    ['headerText', renderer.headerTextColor],
    ['bodyBackground', renderer.bodyBackgroundColor],
    ['bodyText', renderer.bodyTextColor],
    ['authorName', renderer.authorNameTextColor],
    ['timestamp', renderer.timestampColor],
    ['moneyChipBackground', renderer.moneyChipBackgroundColor],
    ['moneyChipText', renderer.moneyChipTextColor],
    ['background', renderer.backgroundColor],
  ]
  const colors: ChatPaidColors = {}
  for (const [key, value] of entries) {
    if (typeof value === 'number')
      colors[key] = value
  }
  return Object.keys(colors).length > 0 ? colors : null
}

function readSticker(renderer: Renderer): ChatStickerAsset | null {
  const thumbs = [...(renderer.sticker?.thumbnails ?? [])]
    .filter(thumb => typeof thumb.url === 'string' && thumb.url)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
  const url = thumbs[0]?.url
  if (!url)
    return null
  return {
    name: renderer.sticker?.accessibility?.accessibilityData?.label?.trim() || null,
    url: url.startsWith('//') ? `https:${url}` : url,
  }
}

export function toRecord(
  item: ChatItemWrapper | undefined,
  videoId: string,
  seq: number,
  emojis?: Map<string, ChatEmoji>,
): ChatRecord | null {
  if (!item)
    return null

  let renderer: Renderer | undefined
  let header: SponsorshipsHeader | undefined
  let kind: ChatRecord['msg']['kind'] = 'text'
  if (item.liveChatTextMessageRenderer) {
    renderer = item.liveChatTextMessageRenderer
  }
  else if (item.liveChatPaidMessageRenderer) {
    renderer = item.liveChatPaidMessageRenderer
    kind = 'superchat'
  }
  else if (item.liveChatPaidStickerRenderer) {
    renderer = item.liveChatPaidStickerRenderer
    kind = 'sticker'
  }
  else if (item.liveChatMembershipItemRenderer) {
    renderer = item.liveChatMembershipItemRenderer
    kind = 'membership'
  }
  else if (item.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer) {
    renderer = item.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer
    header = renderer.header?.liveChatSponsorshipsHeaderRenderer
    kind = 'gift'
  }
  else if (item.liveChatSponsorshipsGiftRedemptionAnnouncementRenderer) {
    renderer = item.liveChatSponsorshipsGiftRedemptionAnnouncementRenderer
    kind = 'giftRedemption'
  }
  if (!renderer)
    return null

  const runs = header?.primaryText?.runs ?? renderer.message?.runs
  let text = ''
  const emoji: { id: string }[] = []
  for (const run of runs ?? []) {
    if (typeof run.text === 'string') {
      text += run.text
    }
    else if (run.emoji?.emojiId) {
      emoji.push({ id: run.emoji.emojiId })
      if (emojis) {
        const asset = toEmojiAsset(run.emoji)
        if (asset && !emojis.has(asset.id))
          emojis.set(asset.id, asset)
      }
    }
  }

  const timestampUs = renderer.timestampUsec
  const msg: ChatRecord['msg'] = {
    author: header?.authorName?.simpleText ?? renderer.authorName?.simpleText,
    text,
    kind,
    sc: renderer.purchaseAmountText?.simpleText ?? null,
    timestampUs,
  }
  if (kind === 'membership') {
    const primary = readText(renderer.headerPrimaryText)
    const subtext = readText(renderer.headerSubtext)
    if (primary)
      msg.membershipPrimary = primary
    // 老数据里会员留言（带正文）被记成 membership；新数据按普通弹幕处理，徽章仍保留成员身份。
    if (text.trim()) {
      kind = 'text'
      msg.kind = 'text'
      msg.memberMessage = true
    }
    const header = subtext || primary
    if (header)
      msg.header = header
  }
  const colors = readPaidColors(renderer)
  if (colors)
    msg.colors = colors
  if (kind === 'sticker') {
    const sticker = readSticker(renderer)
    if (sticker)
      msg.sticker = sticker
  }
  if (kind === 'gift') {
    const giftCount = giftCountOf(runs, text)
    if (giftCount != null)
      msg.giftCount = giftCount
  }
  if (renderer.authorExternalChannelId)
    msg.authorId = renderer.authorExternalChannelId
  if (emoji.length)
    msg.emoji = emoji
  const badges = badgeNames(header?.authorBadges ?? renderer.authorBadges)
  if (badges.length)
    msg.badges = badges

  const record: ChatRecord = { seq, video: videoId, ts: 0, msg }
  const rendererId = (renderer as unknown as { id?: unknown }).id
  if (typeof rendererId === 'string' && rendererId)
    record.rendererId = rendererId
  if (timestampUs) {
    const seconds = Number(timestampUs) / 1_000_000
    if (Number.isFinite(seconds))
      record.ts = Math.round(seconds)
  }
  return record
}

export function videoIdFromFile(file: string): string | null {
  return VIDEO_ID_RE.exec(basename(file))?.[0] ?? null
}

export async function normalizeLiveChat(
  input: string,
  output: string,
  videoId: string,
): Promise<NormalizeResult> {
  const text = readFileSync(input, 'utf8')
  const stream = createWriteStream(output, 'utf8')
  const counts: NormalizeResult['counts'] = {
    text: 0,
    superchat: 0,
    sticker: 0,
    membership: 0,
    gift: 0,
    giftRedemption: 0,
  }
  const skippedKinds: Record<string, number> = {}
  const emojis = new Map<string, ChatEmoji>()
  let seq = 0
  let skipped = 0
  const noteSkipped = (kind: string) => {
    skipped += 1
    skippedKinds[kind] = (skippedKinds[kind] ?? 0) + 1
  }

  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim()
    if (!trimmed)
      continue
    let line: RawLine
    try {
      line = JSON.parse(trimmed) as RawLine
    }
    catch {
      noteSkipped('(unparsable line)')
      continue
    }
    for (const action of line.replayChatItemAction?.actions ?? []) {
      const item = action.addChatItemAction?.item
      const record = toRecord(item, videoId, ++seq, emojis)
      if (!record) {
        if (item)
          noteSkipped(Object.keys(item).find(key => key.endsWith('Renderer')) ?? '(unknown item)')
        continue
      }
      counts[record.msg.kind] += 1
      stream.write(`${JSON.stringify(record)}\n`)
    }
  }

  await new Promise<void>((done, fail) => {
    stream.end((error?: Error | null) => (error ? fail(error) : done()))
  })

  mergeEmojiSidecar(output, videoId, emojis)

  return {
    total: Object.values(counts).reduce((sum, n) => sum + n, 0),
    counts,
    skipped,
    skippedKinds,
    emojis: emojis.size,
  }
}

/**
 * `emoji_<videoId>.json`：id → 图片地址 + 名称，供 `stream-datapack` 写进 pack、
 * `fetch:emoji` 镜像到对象存储。没有表情时删掉旧文件，避免重跑后留下过期的表。
 */
export function writeEmojiSidecar(output: string, videoId: string, emojis: Map<string, ChatEmoji>): void {
  const path = join(dirname(output), `emoji_${videoId}.json`)
  if (emojis.size === 0) {
    if (existsSync(path))
      unlinkSync(path)
    return
  }
  const payload = {
    schema: CHAT_EMOJI_SCHEMA,
    emojis: [...emojis.values()].sort((a, b) => a.id.localeCompare(b.id)),
  }
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

/**
 * 合并已有 sidecar 再写：实时采集可能已经镜像了等待室出现的表情，
 * 回放归一化不能把它们覆盖掉。
 */
export function mergeEmojiSidecar(output: string, videoId: string, emojis: Map<string, ChatEmoji>): void {
  const path = join(dirname(output), `emoji_${videoId}.json`)
  if (existsSync(path)) {
    try {
      const payload = JSON.parse(readFileSync(path, 'utf8')) as { emojis?: ChatEmoji[] }
      for (const asset of payload.emojis ?? []) {
        if (asset?.id && asset.url && !emojis.has(asset.id))
          emojis.set(asset.id, asset)
      }
    }
    catch {
      // 坏档按不存在处理，下面会覆写成新表
    }
  }
  writeEmojiSidecar(output, videoId, emojis)
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    options: {
      out: { type: 'string' },
      video: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  })
  const input = positionals[0]
  if (values.help || !input) {
    console.log('用法：bun scripts/lib/live-chat.ts <live_chat.json> [--out <路径>] [--video <id>]')
    process.exit(values.help ? 0 : 1)
  }
  const inputPath = resolve(input)
  const videoId = values.video ?? videoIdFromFile(inputPath) ?? 'unknown'
  const outputPath = values.out
    ? resolve(values.out)
    : join(dirname(inputPath), `danmaku_${videoId}.jsonl`)
  const result = await normalizeLiveChat(inputPath, outputPath, videoId)
  const skippedDetail = Object.entries(result.skippedKinds)
    .map(([kind, count]) => `${kind.replace(/^liveChat|Renderer$/g, '')} ${count}`)
    .join(' / ')
  console.log(`[live-chat] ${result.total} 条（SC ${result.counts.superchat} / 贴纸 ${result.counts.sticker} / 会员 ${result.counts.membership} / 赠出会员 ${result.counts.gift} / 领取赠礼 ${result.counts.giftRedemption}；表情 ${result.emojis}；跳过 ${result.skipped}${skippedDetail ? `：${skippedDetail}` : ''}）→ ${outputPath}`)
}
