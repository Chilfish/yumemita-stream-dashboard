import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import type { Db } from '@/db/connection'
import { streams, streamDetails } from '@/db/schema'
import type { StreamSummary } from '@/types/dataset'
import type { StreamListOptions, StreamListResult, StreamNeighbors, StreamDetailDto } from '@/types/db'
import { mapStreamSummary, maskMemberOnlyMetrics, toNumber } from './shared'

const NEWEST_FIRST = sql`${streams.startedAt} desc nulls last`

function toSummary(row: typeof streams.$inferSelect, rank: number): StreamSummary {
  return mapStreamSummary(row, rank)
}

function toPublicSummary(row: typeof streams.$inferSelect, rank: number): StreamSummary {
  return maskMemberOnlyMetrics(toSummary(row, rank))
}

export async function listStreams(
  db: Db,
  datasetId: string,
  options: StreamListOptions = {},
): Promise<StreamListResult> {
  const limit = Math.min(options.limit ?? 500, 2000)
  const offset = Math.max(options.offset ?? 0, 0)
  const where = and(
    eq(streams.datasetId, datasetId),
    options.availability ? eq(streams.availability, options.availability) : undefined,
  )

  // 一次窗口函数取回总数与当前页，避免多一次 HTTP 往返。
  const rows = await db
    .select({
      ...getTableColumns(streams),
      total: sql<number>`count(*) over()::int`,
    })
    .from(streams)
    .where(where)
    .orderBy(NEWEST_FIRST)
    .limit(limit)
    .offset(offset)

  return {
    streams: rows.map((row, index) => toPublicSummary(row, offset + index + 1)),
    total: rows[0]?.total ?? 0,
  }
}

export async function getStream(
  db: Db,
  datasetId: string,
  videoId: string,
): Promise<StreamSummary | null> {
  const [row] = await db
    .select()
    .from(streams)
    .where(and(eq(streams.datasetId, datasetId), eq(streams.videoId, videoId)))
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

export async function getStreamNeighbors(
  db: Db,
  datasetId: string,
  videoId: string,
): Promise<StreamNeighbors> {
  const ordered = await db
    .select({ videoId: streams.videoId })
    .from(streams)
    .where(eq(streams.datasetId, datasetId))
    .orderBy(NEWEST_FIRST)

  const index = ordered.findIndex(row => row.videoId === videoId)
  if (index === -1) return { previous: null, next: null }

  const previousId = ordered[index - 1]?.videoId
  const nextId = ordered[index + 1]?.videoId
  const ids = [previousId, nextId].filter((value): value is string => Boolean(value))
  if (ids.length === 0) return { previous: null, next: null }

  const rows = await db
    .select()
    .from(streams)
    .where(and(eq(streams.datasetId, datasetId), inArray(streams.videoId, ids)))
  const byVideo = new Map(rows.map(row => [row.videoId, row]))

  const previous = previousId ? byVideo.get(previousId) : undefined
  const next = nextId ? byVideo.get(nextId) : undefined

  return {
    previous: previous ? toPublicSummary(previous, index) : null,
    next: next ? toPublicSummary(next, index + 2) : null,
  }
}

export async function getStreamDetail(
  db: Db,
  datasetId: string,
  videoId: string,
): Promise<StreamDetailDto | null> {
  const [row] = await db
    .select()
    .from(streams)
    .where(and(eq(streams.datasetId, datasetId), eq(streams.videoId, videoId)))
  if (!row) return null

  const [detail] = await db
    .select()
    .from(streamDetails)
    .where(eq(streamDetails.streamId, row.id))

  return {
    summary: toSummary(row, 0),
    density: detail?.density ?? null,
    coveragePct: toNumber(detail?.coveragePct),
    timeRange: detail?.timeRange ?? null,
    badges: detail?.badges ?? null,
    hashtags: detail?.hashtags ?? null,
    emojiKinds: detail?.emojiKinds ?? null,
    ownerChats: detail?.ownerChats ?? null,
    emojis: detail?.emojis ?? null,
    videoExtra: detail?.videoExtra ?? null,
  }
}
