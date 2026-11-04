import { sql } from 'drizzle-orm'
import type { Db } from '@/db/connection'
import { streams } from '@/db/schema'
import { shiftDateKey } from '@/lib/group'
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

const DAY_WINDOW = 40
const NEWEST_FIRST = sql`${streams.startedAt} desc nulls last`
const PUBLIC_ONLY = sql`${streams.availability} is distinct from ${MEMBER_ONLY_AVAILABILITY}`
const PUBLIC_WEIGHT = sql`case when ${streams.availability} is distinct from ${MEMBER_ONLY_AVAILABILITY} then 1 else 0 end`

type StreamRow = typeof streams.$inferSelect

function toGroupStream(row: StreamRow): GroupStreamSummary {
  const memberOnly = isMemberOnly(row.availability)
  return {
    datasetId: row.datasetId,
    date: row.date ?? '',
    videoId: row.videoId,
    title: row.title,
    startedAt: toIso(row.startedAt),
    durationSec: row.durationSec,
    availability: row.availability,
    avgConcurrent: memberOnly ? null : toNumber(row.avgConcurrent),
    maxConcurrent: memberOnly ? null : row.maxConcurrent,
    chatTotal: memberOnly ? 0 : row.chatTotal,
    superchats: memberOnly ? 0 : row.superchats,
    vstatsViews: memberOnly ? null : row.vstatsViews,
    snapshotViews: memberOnly ? null : row.snapshotViews,
    thumbnail: row.thumbnailKey,
  }
}

async function memberStats(db: Db): Promise<GroupMemberStat[]> {
  const rows = await db
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

async function dayStats(db: Db): Promise<GroupDayStat[]> {
  const rows = await db
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

async function latestStreams(db: Db): Promise<GroupStreamSummary[]> {
  const rows = await db
    .selectDistinctOn([streams.datasetId])
    .from(streams)
    // 首页主视觉只取公开场次，会员限定不占大图。
    .where(PUBLIC_ONLY)
    .orderBy(streams.datasetId, NEWEST_FIRST)
  return rows.map(toGroupStream)
}

async function recentStreams(db: Db): Promise<GroupStreamSummary[]> {
  const rows = await db
    .select()
    .from(streams)
    .orderBy(NEWEST_FIRST)
    .limit(GROUP_RECENT_LIMIT)
  return rows.map(toGroupStream)
}

export async function getGroupSummary(db: Db): Promise<GroupSummaryFile> {
  const [members, days, latest, recent] = await Promise.all([
    memberStats(db),
    dayStats(db),
    latestStreams(db),
    recentStreams(db),
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

export async function getGroupGallery(db: Db): Promise<GroupGalleryFile> {
  const rows = await db
    .select()
    .from(streams)
    .orderBy(NEWEST_FIRST)
  return {
    schema: GROUP_GALLERY_SCHEMA,
    generatedAt: new Date().toISOString(),
    streams: rows.map(toGroupStream),
  }
}
