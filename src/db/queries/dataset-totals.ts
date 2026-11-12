import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '@/db/connection'
import { runBatch } from '@/db/batch'
import {
  authors,
  comments,
  paidEvents,
  streamAuthors,
  streamDetails,
  streams,
  streamWords,
} from '@/db/schema'
import {
  buildStreamShapeFromSeries,
  currencyRows,
  type AggregatedAuthor,
  type AggregatedWord,
  type AggregationMode,
  type DatasetTotals,
  type PeakChatMinute,
  type StreamExtreme,
} from '@/lib/aggregate'
import type { ChatByKind, CurrencyTotal, EmojiCount } from '@/types/datapack'
import { isMemberOnly } from '@/lib/visibility'
import { isV2Pack } from '@/lib/schema-version'
import { involvesMember } from './streams'
import { toIso } from './shared'

const TOP_WORDS = 40
const TOP_AUTHORS = 30

interface CommentStat {
  streamId: number
  count: number
  likes: number
}

interface StickerStat {
  currency: string | null
  count: number
  amount: string | null
}

interface WordStat {
  word: string
  count: number
  streams: number
}

interface AuthorStat {
  authorId: string
  name: string | null
  messages: number
  superchats: number
  stickers: number
  memberships: number
  streams: number
}

interface DetailStat {
  streamId: number
  badges: unknown
  hashtags: unknown
  emojiKinds: unknown
  perMinute: unknown
}

function startedAtMs(value: Date | string | null): number {
  const iso = toIso(value)
  return iso == null ? Number.NEGATIVE_INFINITY : Date.parse(iso)
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

/** 与 `stream-datapack` 生成 `paidSharePct` 时的精度一致。 */
function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function asRecord(value: unknown): Record<string, number> {
  return value && typeof value === 'object' ? (value as Record<string, number>) : {}
}

function asNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    : []
}

function asEmojiTop(value: unknown): EmojiCount[] {
  if (!value || typeof value !== 'object') return []
  const top = (value as { top?: unknown }).top
  return Array.isArray(top) ? (top as EmojiCount[]) : []
}

function addCurrency(target: Map<string, CurrencyTotal>, source: unknown): void {
  if (!source || typeof source !== 'object') return
  for (const [currency, total] of Object.entries(source as Record<string, Partial<CurrencyTotal>>)) {
    const current = target.get(currency) ?? { count: 0, amount: 0 }
    current.count += total?.count ?? 0
    current.amount += total?.amount ?? 0
    target.set(currency, current)
  }
}

function aggregationMode(fullCount: number, total: number): AggregationMode {
  if (fullCount === 0) return 'top-lists'
  return fullCount === total ? 'full' : 'partial'
}

function maxBy<T>(items: T[], value: (item: T) => number | null | undefined): T | null {
  let best: T | null = null
  let bestValue = Number.NEGATIVE_INFINITY
  for (const item of items) {
    const current = value(item)
    if (current == null || !Number.isFinite(current)) continue
    if (current > bestValue) {
      best = item
      bestValue = current
    }
  }
  return best
}

/**
 * 按数据库当前状态重算公开口径汇总。
 *
 * 只读窄列与 SQL 聚合结果：词频 / 作者在 SQL 里 `sum + group by`，
 * `stream_details` 只取 badges / hashtags / emojiKinds / 每分钟序列。
 * 不还原 pack，也不加载 paid_events 的完整明细。
 */
export async function computeDatasetPublicTotals(
  db: Db,
  datasetId: string,
): Promise<DatasetTotals> {
  const rows = await db
    .select({
      id: streams.id,
      videoId: streams.videoId,
      title: streams.title,
      startedAt: streams.startedAt,
      durationSec: streams.durationSec,
      availability: streams.availability,
      chatTotal: streams.chatTotal,
      chatByKind: streams.chatByKind,
      pureEmojiOnly: streams.pureEmojiOnly,
      uniqueAuthors: streams.uniqueAuthors,
      superchats: streams.superchats,
      stickers: streams.stickers,
      memberships: streams.memberships,
      gifts: streams.gifts,
      vstatsViews: streams.vstatsViews,
      vstatsLikes: streams.vstatsLikes,
      snapshotViews: streams.snapshotViews,
      snapshotLikes: streams.snapshotLikes,
      avgConcurrent: streams.avgConcurrent,
      watchTimeHours: streams.watchTimeHours,
      paidSharePct: streams.paidSharePct,
      scTotalsByCurrency: streams.scTotalsByCurrency,
      commentsCaptured: streams.commentsCaptured,
      sourceSchema: streams.sourceSchema,
    })
    .from(streams)
    .where(involvesMember(datasetId))

  const ordered = rows
    .slice()
    .sort((a, b) => startedAtMs(b.startedAt) - startedAtMs(a.startedAt))
  const publicRows = ordered.filter(row => !isMemberOnly(row.availability))
  const publicIds = publicRows.map(row => row.id)

  const [commentStats, stickerStats, wordStats, authorStats, detailStats] = publicIds.length > 0
    ? await runBatch<[
        CommentStat[],
        StickerStat[],
        WordStat[],
        AuthorStat[],
        DetailStat[],
      ]>(db, [
        db
          .select({
            streamId: comments.streamId,
            count: sql<number>`count(*)::int`,
            likes: sql<number>`coalesce(sum(${comments.likes}), 0)::int`,
          })
          .from(comments)
          .where(inArray(comments.streamId, publicIds))
          .groupBy(comments.streamId),
        db
          .select({
            currency: paidEvents.currency,
            count: sql<number>`count(*)::int`,
            amount: sql<string>`coalesce(sum(${paidEvents.amount}), 0)`,
          })
          .from(paidEvents)
          .where(and(inArray(paidEvents.streamId, publicIds), eq(paidEvents.kind, 'sticker')))
          .groupBy(paidEvents.currency),
        db
          .select({
            word: streamWords.word,
            count: sql<number>`sum(${streamWords.count})::int`,
            streams: sql<number>`count(distinct ${streamWords.streamId})::int`,
          })
          .from(streamWords)
          .where(inArray(streamWords.streamId, publicIds))
          .groupBy(streamWords.word)
          .orderBy(desc(sql`sum(${streamWords.count})`), asc(streamWords.word))
          .limit(TOP_WORDS),
        db
          .select({
            authorId: streamAuthors.authorId,
            name: authors.name,
            messages: sql<number>`sum(${streamAuthors.messages})::int`,
            superchats: sql<number>`sum(${streamAuthors.superchats})::int`,
            stickers: sql<number>`sum(${streamAuthors.stickers})::int`,
            memberships: sql<number>`sum(${streamAuthors.memberships})::int`,
            streams: sql<number>`count(*)::int`,
          })
          .from(streamAuthors)
          .leftJoin(authors, eq(authors.authorId, streamAuthors.authorId))
          .where(inArray(streamAuthors.streamId, publicIds))
          .groupBy(streamAuthors.authorId, authors.name)
          .orderBy(desc(sql`sum(${streamAuthors.messages})`), asc(streamAuthors.authorId))
          .limit(TOP_AUTHORS),
        db
          .select({
            streamId: streamDetails.streamId,
            badges: streamDetails.badges,
            hashtags: streamDetails.hashtags,
            emojiKinds: streamDetails.emojiKinds,
            perMinute: sql<unknown>`${streamDetails.density}->'perMinute'`,
          })
          .from(streamDetails)
          .where(inArray(streamDetails.streamId, publicIds)),
      ])
    : [[], [], [], [], []] as [
        CommentStat[],
        StickerStat[],
        WordStat[],
        AuthorStat[],
        DetailStat[],
      ]

  const commentsByStream = new Map(commentStats.map(row => [row.streamId, row]))
  const detailsByStream = new Map(detailStats.map(row => [row.streamId, row]))

  const chatByKind: ChatByKind = { text: 0, superchat: 0, sticker: 0, membership: 0, gift: 0 }
  const scTotals = new Map<string, CurrencyTotal>()
  const stickerTotals = new Map<string, CurrencyTotal>()
  const badgeCounts = new Map<string, number>()
  const emojiCounts = new Map<string, number>()
  const hashtagCounts = new Map<string, number>()
  const perMinuteSeries: number[][] = []
  const publicStats: {
    videoId: string
    title: string
    chat: number
    sc: number
    avg: number | null
  }[] = []

  let durationSec = 0
  let chatTotal = 0
  let pureEmojiOnly = 0
  let uniqueAuthorsSum = 0
  let commentTotal = 0
  let commentLikes = 0
  let views = 0
  let likes = 0
  let watchHours = 0
  let paidShareSum = 0
  let paidShareCount = 0
  let weightedAvgNumerator = 0
  let weightedAvgDenominator = 0
  let withVstatsCount = 0
  let bestPeak: PeakChatMinute | null = null

  for (const row of publicRows) {
    const kind = (row.chatByKind ?? {}) as Partial<ChatByKind>
    chatByKind.text += kind.text ?? 0
    chatByKind.superchat += kind.superchat ?? 0
    chatByKind.sticker += kind.sticker ?? 0
    chatByKind.membership += kind.membership ?? 0
    chatByKind.gift = (chatByKind.gift ?? 0) + (kind.gift ?? 0)

    durationSec += row.durationSec ?? 0
    chatTotal += row.chatTotal
    pureEmojiOnly += row.pureEmojiOnly
    uniqueAuthorsSum += row.uniqueAuthors

    const comment = commentsByStream.get(row.id)
    if (row.commentsCaptured != null || (comment?.count ?? 0) > 0)
      commentTotal += row.commentsCaptured ?? comment?.count ?? 0
    commentLikes += comment?.likes ?? 0

    views += row.vstatsViews ?? row.snapshotViews ?? 0
    likes += row.vstatsLikes ?? row.snapshotLikes ?? 0
    watchHours += toNumber(row.watchTimeHours) ?? 0

    const avgConcurrent = toNumber(row.avgConcurrent)
    if (avgConcurrent != null) {
      withVstatsCount += 1
      if (row.durationSec) {
        weightedAvgNumerator += avgConcurrent * row.durationSec
        weightedAvgDenominator += row.durationSec
      }
    }

    addCurrency(scTotals, row.scTotalsByCurrency)

    const detail = detailsByStream.get(row.id)
    for (const [badge, count] of Object.entries(asRecord(detail?.badges)))
      badgeCounts.set(badge, (badgeCounts.get(badge) ?? 0) + count)
    for (const emoji of asEmojiTop(detail?.emojiKinds)) {
      if (!emoji?.id) continue
      emojiCounts.set(emoji.id, (emojiCounts.get(emoji.id) ?? 0) + (emoji.count ?? 0))
    }
    for (const [tag, count] of Object.entries(asRecord(detail?.hashtags)))
      hashtagCounts.set(tag, (hashtagCounts.get(tag) ?? 0) + count)

    const minutes = asNumberArray(detail?.perMinute)
    perMinuteSeries.push(minutes)
    // 新 ingest 直接存精确值；旧行没有这一列时用每分钟序列近似。
    const sourceShare = toNumber(row.paidSharePct)
    if (sourceShare != null) {
      paidShareSum += sourceShare
      paidShareCount += 1
    }
    else {
      const timed = minutes.reduce((sum, value) => sum + value, 0)
      if (timed > 0) {
        const paidCount = row.superchats + row.stickers + row.memberships + row.gifts
        paidShareSum += round((paidCount / timed) * 100, 1)
        paidShareCount += 1
      }
    }
    const startedAt = toIso(row.startedAt)
    for (let index = 0; index < minutes.length; index += 1) {
      const count = minutes[index] ?? 0
      if (count > (bestPeak?.value ?? 0)) {
        bestPeak = {
          videoId: row.videoId,
          title: row.title,
          value: count,
          offsetMin: index,
          at: startedAt
            ? new Date(Date.parse(startedAt) + index * 60_000).toISOString()
            : null,
        }
      }
    }

    publicStats.push({
      videoId: row.videoId,
      title: row.title,
      chat: row.chatTotal,
      sc: row.superchats,
      avg: avgConcurrent,
    })
  }

  for (const row of stickerStats) {
    const currency = row.currency ?? '—'
    const current = stickerTotals.get(currency) ?? { count: 0, amount: 0 }
    current.count += row.count
    current.amount += Number(row.amount ?? 0)
    stickerTotals.set(currency, current)
  }

  const total = publicRows.length
  const fullCount = publicRows.filter(row => isV2Pack(row.sourceSchema)).length
  const bestByAvgRow = maxBy(publicStats, item => item.avg)
  const bestByChatRow = maxBy(publicStats, item => item.chat)
  const bestByScRow = maxBy(publicStats, item => item.sc)

  return {
    streamCount: ordered.length,
    memberOnlyCount: ordered.length - publicRows.length,
    withVstatsCount,
    durationSec,
    chatTotal,
    chatByKind,
    pureEmojiOnly,
    uniqueAuthorsSum,
    commentTotal,
    commentLikes,
    views,
    likes,
    watchHours,
    weightedAvgConcurrent: weightedAvgDenominator > 0
      ? weightedAvgNumerator / weightedAvgDenominator
      : null,
    avgChatPerMinute: durationSec > 0 ? chatTotal / (durationSec / 60) : null,
    paidSharePct: paidShareCount > 0 ? paidShareSum / paidShareCount : null,
    scByCurrency: currencyRows(Object.fromEntries(scTotals)),
    stickerByCurrency: currencyRows(Object.fromEntries(stickerTotals)),
    topWords: wordStats.map<AggregatedWord>(row => ({
      word: row.word,
      count: row.count,
      streams: row.streams,
    })),
    topAuthors: authorStats.map<AggregatedAuthor>(row => ({
      author: row.name ?? row.authorId,
      authorId: row.authorId,
      messages: row.messages,
      superchats: row.superchats,
      stickers: row.stickers,
      memberships: row.memberships,
      badges: [],
      streams: row.streams,
    })),
    aggregation: {
      words: aggregationMode(fullCount, total),
      authors: aggregationMode(fullCount, total),
      coverage: { words: fullCount, authors: fullCount, total },
    },
    badges: [...badgeCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    emoji: [...emojiCounts.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
      .slice(0, 20),
    hashtags: [...hashtagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    bestByAvg: bestByAvgRow
      ? {
          videoId: bestByAvgRow.videoId,
          title: bestByAvgRow.title,
          value: bestByAvgRow.avg ?? 0,
        } satisfies StreamExtreme
      : null,
    bestByChat: bestByChatRow
      ? {
          videoId: bestByChatRow.videoId,
          title: bestByChatRow.title,
          value: bestByChatRow.chat,
        } satisfies StreamExtreme
      : null,
    bestBySc: bestByScRow
      ? {
          videoId: bestByScRow.videoId,
          title: bestByScRow.title,
          value: bestByScRow.sc,
        } satisfies StreamExtreme
      : null,
    peakChatMinute: bestPeak,
    streamShape: buildStreamShapeFromSeries(perMinuteSeries),
  }
}
