import { sql } from 'drizzle-orm'
import { runBatch } from '@/db/batch'
import type { Db } from '@/db/connection'
import { streams } from '@/db/schema'
import { ATTENDANCE_WINDOW_DAYS, shiftDateKey } from '@/lib/group'
import { isMemberOnly, MEMBER_ONLY_AVAILABILITY } from '@/lib/visibility'
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

const DAY_WINDOW = ATTENDANCE_WINDOW_DAYS
const NEWEST_FIRST = sql`${streams.startedAt} desc nulls last`
const PUBLIC_ONLY = sql`${streams.availability} is distinct from ${MEMBER_ONLY_AVAILABILITY}`
const PUBLIC_WEIGHT = sql`case when ${streams.availability} is distinct from ${MEMBER_ONLY_AVAILABILITY} then 1 else 0 end`

/** 组级列表只渲染这些字段，避免把整行 jsonb 指标拉回来。 */
const GROUP_STREAM_COLUMNS = {
  datasetId: streams.datasetId,
  date: streams.date,
  videoId: streams.videoId,
  title: streams.title,
  startedAt: streams.startedAt,
  durationSec: streams.durationSec,
  availability: streams.availability,
  avgConcurrent: streams.avgConcurrent,
  maxConcurrent: streams.maxConcurrent,
  chatTotal: streams.chatTotal,
  superchats: streams.superchats,
  vstatsViews: streams.vstatsViews,
  snapshotViews: streams.snapshotViews,
  thumbnailKey: streams.thumbnailKey,
}

export function buildMemberStatsQuery(db: Db) {
  return db
    .select({
      datasetId: streams.datasetId,
      streamCount: sql<number>`count(*)::int`,
      // 场次数包含会员限定；派生指标只累加公开场次。
      chatTotal: sql<number>`coalesce(sum(case when ${PUBLIC_WEIGHT} = 1 then ${streams.chatTotal} else 0 end), 0)::bigint`,
      superchats: sql<number>`coalesce(sum(case when ${PUBLIC_WEIGHT} = 1 then ${streams.superchats} else 0 end), 0)::bigint`,
      durationSec: sql<number>`coalesce(sum(case when ${PUBLIC_WEIGHT} = 1 then ${streams.durationSec} else 0 end), 0)::bigint`,
      weighted: sql<string>`coalesce(sum(case when ${PUBLIC_WEIGHT} = 1 then ${streams.avgConcurrent} * ${streams.durationSec} else 0 end), 0)`,
      concurrentDuration: sql<string>`coalesce(sum(case when ${PUBLIC_WEIGHT} = 1 and ${streams.avgConcurrent} is not null then ${streams.durationSec} else 0 end), 0)`,
    })
    .from(streams)
    .groupBy(streams.datasetId)
}

type MemberStatsRow = Awaited<ReturnType<typeof buildMemberStatsQuery>>[number]

export function mapMemberStats(rows: MemberStatsRow[]): GroupMemberStat[] {
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

export function buildDayStatsQuery(db: Db) {
  return db
    .select({
      datasetId: streams.datasetId,
      date: streams.date,
      streamCount: sql<number>`count(*)::int`,
      chat: sql<number>`coalesce(sum(case when ${PUBLIC_WEIGHT} = 1 then ${streams.chatTotal} else 0 end), 0)::bigint`,
      latest: sql<string>`max(${streams.date})`,
    })
    .from(streams)
    .where(sql`${streams.date} is not null`)
    .groupBy(streams.datasetId, streams.date)
}

type DayStatsRow = Awaited<ReturnType<typeof buildDayStatsQuery>>[number]

export function mapDayStats(rows: DayStatsRow[]): GroupDayStat[] {
  return rows
    .filter((row): row is typeof row & { date: string } => Boolean(row.date))
    .filter(row => row.date >= shiftDateKey(row.latest, -(DAY_WINDOW - 1)))
    .map(row => ({
      datasetId: row.datasetId,
      date: row.date,
      streams: row.streamCount,
      chat: Number(row.chat),
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.datasetId.localeCompare(b.datasetId))
}

export function buildLatestStreamsQuery(db: Db) {
  return db
    .selectDistinctOn([streams.datasetId], GROUP_STREAM_COLUMNS)
    .from(streams)
    // 首页主视觉只取公开场次，会员限定不占大图。
    .where(PUBLIC_ONLY)
    .orderBy(streams.datasetId, NEWEST_FIRST)
}

export function buildRecentStreamsQuery(db: Db) {
  return db
    .select(GROUP_STREAM_COLUMNS)
    .from(streams)
    .orderBy(NEWEST_FIRST)
    .limit(GROUP_RECENT_LIMIT)
}

type GroupStreamRow = Awaited<ReturnType<typeof buildRecentStreamsQuery>>[number]

export function mapGroupStreams(rows: GroupStreamRow[]): GroupStreamSummary[] {
  return rows.map(toGroupStream)
}

function toGroupStream(row: GroupStreamRow): GroupStreamSummary {
  const memberOnly = isMemberOnly(row.availability)
  return {
    datasetId: row.datasetId,
    date: row.date ?? '',
    videoId: row.videoId,
    title: row.title,
    startedAt: toIso(row.startedAt),
    durationSec: row.durationSec,
    availability: row.availability,
    masked: memberOnly,
    avgConcurrent: memberOnly ? null : toNumber(row.avgConcurrent),
    maxConcurrent: memberOnly ? null : row.maxConcurrent,
    chatTotal: memberOnly ? 0 : row.chatTotal,
    superchats: memberOnly ? 0 : row.superchats,
    vstatsViews: memberOnly ? null : row.vstatsViews,
    snapshotViews: memberOnly ? null : row.snapshotViews,
    thumbnail: row.thumbnailKey,
  }
}

export function buildGroupSummaryQueries(db: Db) {
  return [
    buildMemberStatsQuery(db),
    buildDayStatsQuery(db),
    buildLatestStreamsQuery(db),
    buildRecentStreamsQuery(db),
  ] as const
}

export type GroupSummaryParts = [
  MemberStatsRow[],
  DayStatsRow[],
  GroupStreamRow[],
  GroupStreamRow[],
]

export function assembleGroupSummary(
  members: MemberStatsRow[],
  days: DayStatsRow[],
  latest: GroupStreamRow[],
  recent: GroupStreamRow[],
): GroupSummaryFile {
  const memberStats = mapMemberStats(members)
  const dayStats = mapDayStats(days)
  const latestStreams = latest.map(toGroupStream)
  const recentStreams = recent.map(toGroupStream)

  const generatedAt = recentStreams
    .map(row => row.startedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1)

  return {
    schema: GROUP_SUMMARY_SCHEMA,
    generatedAt: generatedAt ?? new Date().toISOString(),
    members: memberStats.sort((a, b) => a.datasetId.localeCompare(b.datasetId)),
    days: dayStats,
    latest: latestStreams.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '')),
    recent: recentStreams,
  }
}

export async function getGroupSummary(db: Db): Promise<GroupSummaryFile> {
  const [members, days, latest, recent] = await runBatch<GroupSummaryParts>(
    db,
    buildGroupSummaryQueries(db),
  )
  return assembleGroupSummary(members, days, latest, recent)
}

export function buildGroupGalleryQuery(db: Db) {
  return db
    .select(GROUP_STREAM_COLUMNS)
    .from(streams)
    .orderBy(NEWEST_FIRST)
}

export async function getGroupGallery(db: Db): Promise<GroupGalleryFile> {
  const rows = await buildGroupGalleryQuery(db)
  return {
    schema: GROUP_GALLERY_SCHEMA,
    generatedAt: new Date().toISOString(),
    streams: rows.map(toGroupStream),
  }
}

export type { GroupStreamRow }
