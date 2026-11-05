import { and, eq, getTableColumns, sql } from 'drizzle-orm'
import type { Db } from '@/db/connection'
import { streams } from '@/db/schema'
import type { StreamSummary } from '@/types/dataset'
import type { StreamListOptions, StreamListResult } from '@/types/db'
import { mapStreamSummary, maskMemberOnlyMetrics } from './shared'

const NEWEST_FIRST = sql`${streams.startedAt} desc nulls last`

function toSummary(row: typeof streams.$inferSelect, rank: number): StreamSummary {
  return mapStreamSummary(row, rank)
}

function toPublicSummary(row: typeof streams.$inferSelect, rank: number): StreamSummary {
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
    eq(streams.datasetId, datasetId),
    options.availability ? eq(streams.availability, options.availability) : undefined,
  )

  // 需要 total 时用一次窗口函数；页面只渲染当前页，传 withTotal: false 让查询提前结束。
  return db
    .select({
      ...getTableColumns(streams),
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
    .where(and(eq(streams.datasetId, datasetId), eq(streams.videoId, videoId)))
}

export type StreamQueryRow = Awaited<ReturnType<typeof selectStreamQuery>>[number]

export function mapStreamRow(row: StreamQueryRow): StreamSummary {
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
