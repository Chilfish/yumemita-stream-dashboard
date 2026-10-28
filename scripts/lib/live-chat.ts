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
import { createWriteStream, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

interface Renderer {
  authorName?: { simpleText?: string }
  authorBadges?: BadgeWrapper[]
  message?: { runs?: Run[] }
  timestampUsec?: string
  purchaseAmountText?: { simpleText?: string }
}

interface BadgeWrapper {
  liveChatAuthorBadgeRenderer?: {
    icon?: { iconType?: string }
    tooltip?: string
  }
}

interface Run {
  text?: string
  emoji?: { emojiId?: string }
}

interface ChatItemWrapper {
  liveChatTextMessageRenderer?: Renderer
  liveChatPaidMessageRenderer?: Renderer
  liveChatPaidStickerRenderer?: Renderer
  liveChatMembershipItemRenderer?: Renderer
}

interface RawLine {
  replayChatItemAction?: { actions?: Array<{ addChatItemAction?: { item?: ChatItemWrapper } }> }
}

export interface ChatRecord {
  seq: number
  video: string
  ts: number
  msg: {
    author?: string
    text?: string
    sc?: string | null
    kind: 'text' | 'superchat' | 'sticker' | 'membership'
    timestampUs?: string
    emoji?: { id: string }[]
    badges?: string[]
  }
}

export interface NormalizeResult {
  total: number
  counts: Record<ChatRecord['msg']['kind'], number>
  skipped: number
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

function toRecord(item: ChatItemWrapper | undefined, videoId: string, seq: number): ChatRecord | null {
  if (!item)
    return null

  let renderer: Renderer | undefined
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
  if (!renderer)
    return null

  let text = ''
  const emoji: { id: string }[] = []
  for (const run of renderer.message?.runs ?? []) {
    if (typeof run.text === 'string')
      text += run.text
    else if (run.emoji?.emojiId)
      emoji.push({ id: run.emoji.emojiId })
  }

  const timestampUs = renderer.timestampUsec
  const msg: ChatRecord['msg'] = {
    author: renderer.authorName?.simpleText,
    text,
    kind,
    sc: renderer.purchaseAmountText?.simpleText ?? null,
    timestampUs,
  }
  if (emoji.length)
    msg.emoji = emoji
  const badges = badgeNames(renderer.authorBadges)
  if (badges.length)
    msg.badges = badges

  const record: ChatRecord = { seq, video: videoId, ts: 0, msg }
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
  const counts: NormalizeResult['counts'] = { text: 0, superchat: 0, sticker: 0, membership: 0 }
  let seq = 0
  let skipped = 0

  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim()
    if (!trimmed)
      continue
    let line: RawLine
    try {
      line = JSON.parse(trimmed) as RawLine
    }
    catch {
      skipped += 1
      continue
    }
    for (const action of line.replayChatItemAction?.actions ?? []) {
      const record = toRecord(action.addChatItemAction?.item, videoId, ++seq)
      if (!record) {
        if (action.addChatItemAction?.item)
          skipped += 1
        continue
      }
      counts[record.msg.kind] += 1
      stream.write(`${JSON.stringify(record)}\n`)
    }
  }

  await new Promise<void>((done, fail) => {
    stream.end((error?: Error | null) => (error ? fail(error) : done()))
  })

  return { total: Object.values(counts).reduce((sum, n) => sum + n, 0), counts, skipped }
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
  console.log(`[live-chat] ${result.total} 条（SC ${result.counts.superchat} / 贴纸 ${result.counts.sticker} / 会员 ${result.counts.membership}；跳过 ${result.skipped}）→ ${outputPath}`)
}
