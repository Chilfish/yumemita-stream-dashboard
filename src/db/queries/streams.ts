import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '@/db/connection'
import { streams } from '@/db/schema'
import type { StreamSummary } from '@/types/dataset'
import type { StreamListOptions, StreamListResult, StreamSummaryRow } from '@/types/db'
import { mapStreamSummary, maskMemberOnlyMetrics } from './shared'

const NEWEST_FIRST = sql`${streams.startedAt} desc nulls last`

/**
 * 某成员的场次 = 他做频道主的场次 ∪ 他作为参与者的场次。
 * 两个来源不重叠（`participants` 不含 owner），所以不需要去重。
 */
export function involvesMember(datasetId: string) {
  return sql`(${streams.datasetId} = ${datasetId} or ${datasetId}::text = any(${streams.participants}))`
}

/** 岛屿摘要用到的列；不要退回 `select()`，否则会多带 content_hash 等写路径字段。 */
export const SUMMARY_COLUMNS = {
  datasetId: streams.datasetId,
  participants: streams.participants,
  date: streams.date,
  videoId: streams.videoId,
  title: streams.title,
  url: streams.url,
  startedAt: streams.startedAt,
  endedAt: streams.endedAt,
  durationSec: streams.durationSec,
  durationHms: streams.durationHms,
  availability: streams.availability,
  avgConcurrent: streams.avgConcurrent,
  maxConcurrent: streams.maxConcurrent,
  maxConcurrentAt: streams.maxConcurrentAt,
  watchTimeHours: streams.watchTimeHours,
  vstatsViews: streams.vstatsViews,
  vstatsLikes: streams.vstatsLikes,
  snapshotViews: streams.snapshotViews,
  snapshotLikes: streams.snapshotLikes,
  snapshotComments: streams.snapshotComments,
  chatTotal: streams.chatTotal,
  chatByKind: streams.chatByKind,
  pureEmojiOnly: streams.pureEmojiOnly,
  uniqueAuthors: streams.uniqueAuthors,
  superchats: streams.superchats,
  stickers: streams.stickers,
  memberships: streams.memberships,
  gifts: streams.gifts,
  giftedMemberships: streams.giftedMemberships,
  scTotalsByCurrency: streams.scTotalsByCurrency,
  commentsCaptured: streams.commentsCaptured,
  chatPer1000AvgViewers: streams.chatPer1000AvgViewers,
  likesPer1000Views: streams.likesPer1000Views,
  scPerHour: streams.scPerHour,
  thumbnailKey: streams.thumbnailKey,
  sourceGeneratedAt: streams.sourceGeneratedAt,
}

function toSummary(row: StreamSummaryRow, rank: number): StreamSummary {
  return mapStreamSummary(row, rank)
}

function toPublicSummary(row: StreamSummaryRow, rank: number): StreamSummary {
  return maskMemberOnlyMetrics(toSummary(row, rank))
}

export function buildStreamListQuery(
  db: Db,
  datasetId: string,
  options: StreamListOptions = {},
) {
  const limit = Math.min(options.limit ?? 500, 2000)
  const offset = Math.max(options.offset ?? 0, 0)
  const where = and(
    involvesMember(datasetId),
    options.availability ? eq(streams.availability, options.availability) : undefined,
  )

  // 需要 total 时用一次窗口函数；页面只渲染当前页，传 withTotal: false 让查询提前结束。
  return db
    .select({
      ...SUMMARY_COLUMNS,
      total: options.withTotal === false
        ? sql<number>`0`
        : sql<number>`count(*) over()::int`,
    })
    .from(streams)
    .where(where)
    .orderBy(NEWEST_FIRST)
    .limit(limit)
    .offset(offset)
}

export type StreamListRow = Awaited<ReturnType<typeof buildStreamListQuery>>[number]

export function mapStreamList(rows: StreamListRow[], offset = 0): StreamListResult {
  return {
    streams: rows.map((row, index) => toPublicSummary(row, offset + index + 1)),
    total: rows[0]?.total ?? 0,
  }
}

export async function listStreams(
  db: Db,
  datasetId: string,
  options: StreamListOptions = {},
): Promise<StreamListResult> {
  const offset = Math.max(options.offset ?? 0, 0)
  return mapStreamList(await buildStreamListQuery(db, datasetId, options), offset)
}

/** 单场页的导航索引：命令面板与 j/k 切换只需要标题级字段。 */
export function buildStreamNavQuery(db: Db, datasetId: string) {
  return db
    .select({
      videoId: streams.videoId,
      title: streams.title,
      date: streams.date,
      startedAt: streams.startedAt,
      durationSec: streams.durationSec,
    })
    .from(streams)
    .where(involvesMember(datasetId))
    .orderBy(NEWEST_FIRST)
}

/** 上一场 / 下一场的完整摘要；最多 2 行。 */
export function buildStreamSummariesQuery(db: Db, datasetId: string, videoIds: string[]) {
  return db
    .select(SUMMARY_COLUMNS)
    .from(streams)
    .where(and(involvesMember(datasetId), inArray(streams.videoId, videoIds)))
}

/** sitemap：一次取回全部成员的定位信息，避免每个成员一次 HTTP 往返。 */
export function buildAllStreamRefsQuery(db: Db) {
  return db
    .select({
      datasetId: streams.datasetId,
      videoId: streams.videoId,
      startedAt: streams.startedAt,
      availability: streams.availability,
    })
    .from(streams)
    .orderBy(streams.datasetId, NEWEST_FIRST)
}

/** llms.txt：一次取回全部成员的最新场次标题，避免每个成员一次 HTTP 往返。 */
export function buildAllStreamHeadsQuery(db: Db) {
  return db
    .select({
      datasetId: streams.datasetId,
      videoId: streams.videoId,
      title: streams.title,
      date: streams.date,
      availability: streams.availability,
    })
    .from(streams)
    .orderBy(streams.datasetId, NEWEST_FIRST)
}

export function selectStreamQuery(db: Db, datasetId: string, videoId: string) {
  return db
    .select()
    .from(streams)
    // 联动场从任一参与成员的页面进来都要能打开；URL 里的成员只用于上下文，不再是查找条件。
    .where(and(eq(streams.videoId, videoId), involvesMember(datasetId)))
}

export type StreamQueryRow = Awaited<ReturnType<typeof selectStreamQuery>>[number]

export function mapStreamRow(row: StreamSummaryRow): StreamSummary {
  return toSummary(row, 0)
}

export async function getStream(
  db: Db,
  datasetId: string,
  videoId: string,
): Promise<StreamSummary | null> {
  const [row] = await selectStreamQuery(db, datasetId, videoId)
  return row ? toSummary(row, 0) : null
}

export async function getLatestStream(
  db: Db,
  datasetId: string,
): Promise<StreamSummary | null> {
  const [row] = await db
    .select()
    .from(streams)
    .where(eq(streams.datasetId, datasetId))
    .orderBy(NEWEST_FIRST)
    .limit(1)
  return row ? toPublicSummary(row, 1) : null
}
