/**
 * 把频道列表里的未来场 / 直播中同步到 `scheduled_streams`。
 *
 * 只处理 `is_upcoming` 与 `is_live`：
 * - `is_upcoming` 写入标题、预定时刻、预计时长；没有时刻的进「日期待定」。
 * - `is_live` 只更新直播标记，不新建行；结束后照常由 ingest 写入 `streams`。
 * - 已在 `streams` 里的场次跳过，避免留下过期日程。
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '../../src/db/connection.ts'
import { scheduledStreams } from '../../src/db/schema.ts'
import type { ChannelEntry } from './update-plan.ts'

export interface PlannedScheduleEntry {
  videoId: string
  eventKey: string
  title: string
  url: string
  scheduledAt: Date | null
  expectedMinutes: number | null
}

export interface SchedulePlan {
  upcoming: PlannedScheduleEntry[]
  live: string[]
}

export interface PlanScheduleOptions {
  knownIds?: Set<string>
}

function parseScheduledAt(value: string | null | undefined): Date | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time) : null
}

export function planScheduleEntries(
  entries: ChannelEntry[],
  options: PlanScheduleOptions = {},
): SchedulePlan {
  const upcoming: PlannedScheduleEntry[] = []
  const live: string[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    if (entry.liveStatus !== 'is_upcoming' && entry.liveStatus !== 'is_live') continue
    if (options.knownIds?.has(entry.id)) continue
    if (seen.has(entry.id)) continue
    seen.add(entry.id)

    if (entry.liveStatus === 'is_live') {
      live.push(entry.id)
      continue
    }

    upcoming.push({
      videoId: entry.id,
      eventKey: `yt:${entry.id}`,
      title: entry.title?.trim() || '未命名直播',
      url: `https://www.youtube.com/watch?v=${entry.id}`,
      scheduledAt: parseScheduledAt(entry.scheduledAt),
      expectedMinutes: entry.durationSec
        ? Math.max(1, Math.round(entry.durationSec / 60))
        : null,
    })
  }

  return { upcoming, live }
}

export interface ScheduleSyncResult {
  upserted: number
  live: number
  changed: boolean
}

export async function syncScheduleFromChannel(
  db: Db,
  datasetId: string,
  entries: ChannelEntry[],
  options: { now?: Date; knownIds?: Set<string> } = {},
): Promise<ScheduleSyncResult> {
  const now = options.now ?? new Date()
  const plan = planScheduleEntries(entries, { knownIds: options.knownIds })

  if (plan.upcoming.length > 0) {
    await db
      .insert(scheduledStreams)
      .values(plan.upcoming.map(entry => ({
        datasetId,
        eventKey: entry.eventKey,
        videoId: entry.videoId,
        title: entry.title,
        url: entry.url,
        scheduledAt: entry.scheduledAt,
        expectedMinutes: entry.expectedMinutes,
        source: 'youtube',
        lastSeenAt: now,
        updatedAt: now,
      })))
      .onConflictDoUpdate({
        target: [scheduledStreams.datasetId, scheduledStreams.eventKey],
        set: {
          videoId: sql`excluded.video_id`,
          title: sql`excluded.title`,
          url: sql`excluded.url`,
          source: sql`excluded.source`,
          lastSeenAt: sql`excluded.last_seen_at`,
          updatedAt: sql`excluded.updated_at`,
          // 频道暂时没给时刻时保留旧值，不把已有排期擦掉。
          scheduledAt: sql`coalesce(excluded.scheduled_at, ${scheduledStreams.scheduledAt})`,
          expectedMinutes: sql`coalesce(excluded.expected_minutes, ${scheduledStreams.expectedMinutes})`,
        },
      })
  }

  if (plan.live.length > 0) {
    await db
      .update(scheduledStreams)
      .set({ lastLiveAt: now, lastSeenAt: now, updatedAt: now })
      .where(and(
        eq(scheduledStreams.datasetId, datasetId),
        inArray(scheduledStreams.videoId, plan.live),
      ))
  }

  return {
    upserted: plan.upcoming.length,
    live: plan.live.length,
    changed: plan.upcoming.length + plan.live.length > 0,
  }
}
