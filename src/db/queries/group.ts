import { and, sql } from 'drizzle-orm'
import type { Db } from '@/db/connection'
import { streams } from '@/db/schema'
import { shiftDateKey } from '@/lib/group'
import { MEMBER_ONLY_AVAILABILITY } from '@/lib/visibility'
import {
  GROUP_GALLERY_SCHEMA,
  GROUP_RECENT_LIMIT,
  GROUP_SUMMARY_SCHEMA,
  type GroupDayStat,
  type GroupGalleryFile,
  type GroupMemberStat,
  type GroupStreamSummary,
  type GroupSummaryFile,
} from '@/types/group'
import { toIso, toNumber } from './shared'

const DAY_WINDOW = 40
const NEWEST_FIRST = sql`${streams.startedAt} desc nulls last`

interface GroupQueryOptions {
  /** 默认 `false`：组级统计与相册都不含会员限定场次。 */
  includeMemberOnly?: boolean
}

function visibilityFilter(includeMemberOnly: boolean | undefined) {
  if (includeMemberOnly) return undefined
  return sql`${streams.availability} is distinct from ${MEMBER_ONLY_AVAILABILITY}`
}

type StreamRow = typeof streams.$inferSelect

function toGroupStream(row: StreamRow): GroupStreamSummary {
  return {
    datasetId: row.datasetId,
    date: row.date ?? '',
    videoId: row.videoId,
    title: row.title,
    startedAt: toIso(row.startedAt),
    durationSec: row.durationSec,
    availability: row.availability,
    avgConcurrent: toNumber(row.avgConcurrent),
    maxConcurrent: row.maxConcurrent,
    chatTotal: row.chatTotal,
    superchats: row.superchats,
    vstatsViews: row.vstatsViews,
    snapshotViews: row.snapshotViews,
    thumbnail: row.thumbnailKey,
  }
}

async function memberStats(db: Db, options: GroupQueryOptions): Promise<GroupMemberStat[]> {
  const rows = await db
    .select({
      datasetId: streams.datasetId,
      streamCount: sql<number>`count(*)::int`,
      chatTotal: sql<number>`coalesce(sum(${streams.chatTotal}), 0)::bigint`,
      superchats: sql<number>`coalesce(sum(${streams.superchats}), 0)::bigint`,
      durationSec: sql<number>`coalesce(sum(${streams.durationSec}), 0)::bigint`,
      weighted: sql<string>`coalesce(sum(${streams.avgConcurrent} * ${streams.durationSec}), 0)`,
      concurrentDuration: sql<string>`coalesce(sum(case when ${streams.avgConcurrent} is not null then ${streams.durationSec} else 0 end), 0)`,
    })
    .from(streams)
    .where(visibilityFilter(options.includeMemberOnly))
    .groupBy(streams.datasetId)

  return rows.map(row => {
    const concurrentDuration = Number(row.concurrentDuration)
    return {
      datasetId: row.datasetId,
      streamCount: row.streamCount,
      chatTotal: Number(row.chatTotal),
      superchats: Number(row.superchats),
      durationSec: Number(row.durationSec),
      avgConcurrent: concurrentDuration > 0 ? Number(row.weighted) / concurrentDuration : null,
    }
  })
}

async function dayStats(db: Db, options: GroupQueryOptions): Promise<GroupDayStat[]> {
  const rows = await db
    .select({
      datasetId: streams.datasetId,
      date: streams.date,
      streamCount: sql<number>`count(*)::int`,
      chat: sql<number>`coalesce(sum(${streams.chatTotal}), 0)::bigint`,
      latest: sql<string>`max(${streams.date})`,
    })
    .from(streams)
    .where(and(
      sql`${streams.date} is not null`,
      visibilityFilter(options.includeMemberOnly),
    ))
    .groupBy(streams.datasetId, streams.date)

  return rows
    .filter((row): row is typeof row & { date: string } => Boolean(row.date))
    .filter(row => row.date >= shiftDateKey(row.latest, -DAY_WINDOW))
    .map(row => ({
      datasetId: row.datasetId,
      date: row.date,
      streams: row.streamCount,
      chat: Number(row.chat),
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.datasetId.localeCompare(b.datasetId))
}

async function latestStreams(db: Db, options: GroupQueryOptions): Promise<GroupStreamSummary[]> {
  const rows = await db
    .selectDistinctOn([streams.datasetId])
    .from(streams)
    .where(visibilityFilter(options.includeMemberOnly))
    .orderBy(streams.datasetId, NEWEST_FIRST)
  return rows.map(toGroupStream)
}

async function recentStreams(db: Db, options: GroupQueryOptions): Promise<GroupStreamSummary[]> {
  const rows = await db
    .select()
    .from(streams)
    .where(visibilityFilter(options.includeMemberOnly))
    .orderBy(NEWEST_FIRST)
    .limit(GROUP_RECENT_LIMIT)
  return rows.map(toGroupStream)
}

export async function getGroupSummary(
  db: Db,
  options: GroupQueryOptions = {},
): Promise<GroupSummaryFile> {
  const [members, days, latest, recent] = await Promise.all([
    memberStats(db, options),
    dayStats(db, options),
    latestStreams(db, options),
    recentStreams(db, options),
  ])

  const generatedAt = recent
    .map(row => row.startedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1)

  return {
    schema: GROUP_SUMMARY_SCHEMA,
    generatedAt: generatedAt ?? new Date().toISOString(),
    members: members.sort((a, b) => a.datasetId.localeCompare(b.datasetId)),
    days,
    latest: latest.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '')),
    recent,
  }
}

export async function getGroupGallery(
  db: Db,
  options: GroupQueryOptions = {},
): Promise<GroupGalleryFile> {
  const rows = await db
    .select()
    .from(streams)
    .where(visibilityFilter(options.includeMemberOnly))
    .orderBy(NEWEST_FIRST)
  return {
    schema: GROUP_GALLERY_SCHEMA,
    generatedAt: new Date().toISOString(),
    streams: rows.map(toGroupStream),
  }
}
