import { and, desc, eq, inArray } from 'drizzle-orm'
import type { Db } from '@/db/connection'
import {
  authors,
  comments,
  paidEvents,
  streamAuthors,
  streamDetails,
  streams,
  streamWords,
} from '@/db/schema'
import type {
  ChatDensity,
  ChatEvent,
  ChatInfo,
  CommentsInfo,
  CurrencyTotals,
  DatapackSchema,
  EmojiAsset,
  EmojiKinds,
  GiftMembership,
  Membership,
  OwnerChat,
  PaidInfo,
  Sticker,
  StreamDatapack,
  Superchat,
  TopAuthor,
  TopWord,
  VideoInfo,
  VstatsInfo,
} from '@/types/datapack'
import { toIso, toNumber } from './shared'

type StreamRow = typeof streams.$inferSelect
type DetailRow = typeof streamDetails.$inferSelect
type PaidRow = typeof paidEvents.$inferSelect
type CommentRow = typeof comments.$inferSelect
type WordRow = typeof streamWords.$inferSelect
type AuthorRow = { authorId: string, name: string | null, messages: number, superchats: number, stickers: number, memberships: number }

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function asRecord(value: unknown): Record<string, number> {
  return value && typeof value === 'object' ? (value as Record<string, number>) : {}
}

function currencyTotals(
  rows: { currency: string | null, amount: string | null }[],
): CurrencyTotals {
  const totals: CurrencyTotals = {}
  for (const row of rows) {
    const currency = row.currency ?? '—'
    const amount = toNumber(row.amount) ?? 0
    const current = totals[currency] ?? { count: 0, amount: 0 }
    current.count += 1
    current.amount += amount
    totals[currency] = current
  }
  return totals
}

function groupPaid(rows: PaidRow[]): PaidInfo {
  const superchats: Superchat[] = rows
    .filter(row => row.kind === 'superchat')
    .map(row => ({
      at: toIso(row.at) ?? '',
      author: row.author ?? '',
      amountText: row.amountText ?? '',
      currency: row.currency ?? '',
      amount: toNumber(row.amount) ?? 0,
      message: row.message ?? '',
      emojis: asArray<string>(row.emojis),
    }))

  const stickers: Sticker[] = rows
    .filter(row => row.kind === 'sticker')
    .map(row => ({
      at: toIso(row.at) ?? '',
      author: row.author ?? '',
      amountText: row.amountText ?? '',
      currency: row.currency ?? '',
      amount: toNumber(row.amount) ?? 0,
    }))

  const memberships: Membership[] = rows
    .filter(row => row.kind === 'membership')
    .map(row => ({
      at: toIso(row.at) ?? '',
      author: row.author ?? '',
      header: row.message,
    }))

  const gifts: GiftMembership[] = rows
    .filter(row => row.kind === 'gift')
    .map(row => ({
      at: toIso(row.at) ?? '',
      author: row.author ?? '',
      count: toNumber(row.amount) ?? 0,
      text: row.message ?? '',
    }))

  return {
    superchats,
    scTotalsByCurrency: {},
    stickers,
    stickerTotalsByCurrency: currencyTotals(rows.filter(row => row.kind === 'sticker')),
    memberships,
    gifts,
    paidSharePct: null,
  }
}

function groupComments(row: StreamRow, items: CommentRow[]): CommentsInfo | null {
  if (row.commentsCaptured == null && items.length === 0) return null
  return {
    total: row.commentsCaptured ?? items.length,
    topLevel: items.filter(item => !item.byUploader || true).length,
    replies: 0,
    pinned: items.filter(item => item.pinned).length,
    totalLikes: items.reduce((sum, item) => sum + item.likes, 0),
    items: items.map(item => ({
      author: item.author,
      authorId: item.authorId,
      likes: item.likes,
      at: toIso(item.at),
      pinned: item.pinned,
      byUploader: item.byUploader,
      text: item.text,
    })),
  }
}

function buildChat(
  row: StreamRow,
  detail: DetailRow | undefined,
  paid: PaidRow[],
  commentItems: CommentRow[],
  words: WordRow[],
  authorRows: AuthorRow[],
): ChatInfo {
  const ownerChats = asArray<OwnerChat>(detail?.ownerChats)
  const events = asArray<ChatEvent>(detail?.events)
  const emojiKinds = (detail?.emojiKinds ?? { distinct: 0, top: [] }) as EmojiKinds
  const density = (detail?.density ?? {
    perMinuteMean: null,
    peakMinute: null,
    perMinute: [],
    perMinuteSc: [],
    perFiveMinute: [],
    perTenMinute: [],
  }) as ChatDensity

  const paidInfo = groupPaid(paid)
  paidInfo.scTotalsByCurrency = (row.scTotalsByCurrency ?? {}) as CurrencyTotals

  const topAuthors: TopAuthor[] = authorRows
    .slice()
    .sort((a, b) => b.messages - a.messages)
    .slice(0, 20)
    .map(author => ({
      author: author.name ?? author.authorId,
      authorId: author.authorId,
      messages: author.messages,
      superchats: author.superchats,
      stickers: author.stickers,
      memberships: author.memberships,
      badges: [],
    }))

  const sortedWords = words.slice().sort((a, b) => b.count - a.count)
  const topWords: TopWord[] = sortedWords.slice(0, 40).map(word => ({
    word: word.word,
    count: word.count,
  }))

  void commentItems

  return {
    total: row.chatTotal,
    byKind: (row.chatByKind ?? {}) as ChatInfo['byKind'],
    pureEmojiOnly: row.pureEmojiOnly,
    uniqueAuthors: row.uniqueAuthors,
    ownerMessages: ownerChats.filter(chat => chat.kind !== 'event').length,
    badges: asRecord(detail?.badges),
    timeRange: (detail?.timeRange ?? { firstAt: null, lastAt: null, preRollSec: null }) as ChatInfo['timeRange'],
    coveragePct: toNumber(detail?.coveragePct),
    density,
    paid: paidInfo,
    topAuthors,
    topWords,
    hashtags: asRecord(detail?.hashtags),
    emojiKinds,
    emojis: asArray<EmojiAsset>(detail?.emojis),
    ownerChats,
    events,
  }
}

function buildPack(
  row: StreamRow,
  detail: DetailRow | undefined,
  paid: PaidRow[],
  commentItems: CommentRow[],
  words: WordRow[],
  authorRows: AuthorRow[],
): StreamDatapack {
  const extra = (detail?.videoExtra ?? {}) as Record<string, unknown>

  const video: VideoInfo = {
    id: row.videoId,
    url: row.url,
    title: row.title,
    channelId: (extra.channelId as string | undefined) ?? null,
    channelName: (extra.channelName as string | undefined) ?? null,
    channelUrl: (extra.channelUrl as string | undefined) ?? null,
    channelFollowersAtCapture: (extra.channelFollowersAtCapture as number | undefined) ?? null,
    liveStatus: (extra.liveStatus as string | undefined) ?? null,
    availability: row.availability,
    startedAt: toIso(row.startedAt),
    publishedAt: (extra.publishedAt as string | undefined) ?? null,
    durationSec: row.durationSec,
    durationHms: row.durationHms,
    endedAt: toIso(row.endedAt),
    thumbnail: (extra.thumbnail as string | undefined) ?? null,
    description: (extra.description as string | undefined) ?? null,
    links: asArray<string>(extra.links),
    chapters: asArray<VideoInfo['chapters'][number]>(extra.chapters),
    hasLiveChatReplay: Boolean(extra.hasLiveChatReplay),
    captionsJa: Boolean(extra.captionsJa),
    snapshot: {
      views: row.snapshotViews,
      likes: row.snapshotLikes,
      comments: row.snapshotComments,
    },
  }

  const hasVstats = row.avgConcurrent != null
    || row.maxConcurrent != null
    || row.watchTimeHours != null
    || row.vstatsViews != null
    || row.vstatsLikes != null

  const vstats: VstatsInfo | null = hasVstats
    ? {
        updatedAt: null,
        startedAt: null,
        endedAt: null,
        durationText: null,
        maxConcurrent: row.maxConcurrent,
        maxConcurrentAt: row.maxConcurrentAt,
        avgConcurrent: toNumber(row.avgConcurrent),
        watchTimeHours: toNumber(row.watchTimeHours),
        views: row.vstatsViews,
        likes: row.vstatsLikes,
      }
    : null

  return {
    schema: (row.sourceSchema ?? 'yumemita.stream-datapack/v2') as DatapackSchema,
    generatedAt: toIso(row.sourceGeneratedAt) ?? '',
    video,
    vstats,
    chat: buildChat(row, detail, paid, commentItems, words, authorRows),
    comments: groupComments(row, commentItems),
    derived: {
      chatPer1000AvgViewers: toNumber(row.chatPer1000AvgViewers),
      likesPer1000Views: toNumber(row.likesPer1000Views),
      scPerHour: toNumber(row.scPerHour),
      vstatsVsYtdlpViews: null,
    },
  }
}

async function loadChildren(db: Db, ids: number[]) {
  if (ids.length === 0) {
    return {
      details: [] as DetailRow[],
      paid: [] as PaidRow[],
      comments: [] as CommentRow[],
      words: [] as WordRow[],
      authorRows: [] as (AuthorRow & { streamId: number })[],
    }
  }

  const [details, paid, commentRows, words, authorRows] = await Promise.all([
    db.select().from(streamDetails).where(inArray(streamDetails.streamId, ids)),
    db.select().from(paidEvents).where(inArray(paidEvents.streamId, ids)).orderBy(paidEvents.at),
    db.select().from(comments).where(inArray(comments.streamId, ids)).orderBy(desc(comments.likes)),
    db.select().from(streamWords).where(inArray(streamWords.streamId, ids)),
    db
      .select({
        streamId: streamAuthors.streamId,
        authorId: streamAuthors.authorId,
        name: authors.name,
        messages: streamAuthors.messages,
        superchats: streamAuthors.superchats,
        stickers: streamAuthors.stickers,
        memberships: streamAuthors.memberships,
      })
      .from(streamAuthors)
      .leftJoin(authors, eq(authors.authorId, streamAuthors.authorId))
      .where(inArray(streamAuthors.streamId, ids))
      .orderBy(desc(streamAuthors.messages)),
  ])

  return { details, paid, comments: commentRows, words, authorRows }
}

/** 批量还原一个 dataset 的全部 pack，供 aggregateDataset / compare 使用。 */
export async function getDatasetPacks(
  db: Db,
  datasetId: string,
): Promise<Map<string, StreamDatapack>> {
  const rows = await db.select().from(streams).where(eq(streams.datasetId, datasetId))
  const { details, paid, comments: commentRows, words, authorRows } = await loadChildren(
    db,
    rows.map(row => row.id),
  )

  const byStream = <T extends { streamId: number }>(items: T[]) => {
    const map = new Map<number, T[]>()
    for (const item of items) {
      const list = map.get(item.streamId)
      if (list) list.push(item)
      else map.set(item.streamId, [item])
    }
    return map
  }

  const detailByStream = new Map(details.map(item => [item.streamId, item]))
  const paidByStream = byStream(paid)
  const commentsByStream = byStream(commentRows)
  const wordsByStream = byStream(words)
  const authorsByStream = byStream(authorRows)

  const packs = new Map<string, StreamDatapack>()
  for (const row of rows) {
    packs.set(
      row.videoId,
      buildPack(
        row,
        detailByStream.get(row.id),
        paidByStream.get(row.id) ?? [],
        commentsByStream.get(row.id) ?? [],
        wordsByStream.get(row.id) ?? [],
        authorsByStream.get(row.id) ?? [],
      ),
    )
  }
  return packs
}

export async function getStreamPack(
  db: Db,
  datasetId: string,
  videoId: string,
): Promise<StreamDatapack | null> {
  const [row] = await db
    .select()
    .from(streams)
    .where(and(eq(streams.datasetId, datasetId), eq(streams.videoId, videoId)))
  if (!row) return null

  const { details, paid, comments: commentRows, words, authorRows } = await loadChildren(db, [row.id])
  return buildPack(
    row,
    details[0],
    paid,
    commentRows,
    words,
    authorRows.map(item => ({ ...item, streamId: row.id })),
  )
}
