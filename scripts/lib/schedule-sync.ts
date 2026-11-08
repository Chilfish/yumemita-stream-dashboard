/**
 * 把频道列表里的未来场 / 直播中同步到 `scheduled_streams`。
 *
 * 只处理 `is_upcoming` 与 `is_live`：
 * - `is_upcoming` 写入标题、预定时刻、预计时长；没有时刻的进「日期待定」。
 * - `is_live` 只更新直播标记，不新建行；结束后照常由 ingest 写入 `streams`。
 * - 已在 `streams` 里的场次跳过，避免留下过期日程。
 */
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import type { Db } from '../../src/db/connection.ts'
import { scheduledStreams } from '../../src/db/schema.ts'
import { jstDateKeyFrom, slotForJstTime } from '../../src/lib/schedule.ts'
import type { ChannelEntry } from './update-plan.ts'

export interface PlannedScheduleEntry {
  videoId: string
  eventKey: string
  title: string
  url: string
  date: string | null
  slot: string | null
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

    const scheduledAt = parseScheduledAt(entry.scheduledAt)
    upcoming.push({
      videoId: entry.id,
      eventKey: `yt:${entry.id}`,
      title: entry.title?.trim() || '未命名直播',
      url: `https://www.youtube.com/watch?v=${entry.id}`,
      date: jstDateKeyFrom(scheduledAt),
      slot: slotForJstTime(scheduledAt),
      scheduledAt,
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
  pruned: number
  changed: boolean
}

const STALE_SCHEDULE_DAYS = 30
const DAY_MS = 86_400_000

/**
 * 清理长期不再出现在频道列表里的自动日程。
 *
 * `pending` 本身没有出口：过期后既不会自动变成已入库，也不会消失。
 * 这里按 `last_seen_at` 与日期剪掉自动行；手工行不动，已取消行也不动。
 */
export async function pruneStaleSchedules(
  db: Db,
  datasetId: string,
  now: Date = new Date(),
  days: number = STALE_SCHEDULE_DAYS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - days * DAY_MS)
  const today = jstDateKeyFrom(now.toISOString())
  const deleted = await db
    .delete(scheduledStreams)
    .where(and(
      eq(scheduledStreams.datasetId, datasetId),
      eq(scheduledStreams.source, 'youtube'),
      lt(scheduledStreams.lastSeenAt, cutoff),
      lt(scheduledStreams.date, today),
    ))
    .returning({ eventKey: scheduledStreams.eventKey })
  return deleted.length
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
        date: entry.date,
        slot: entry.slot,
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
          // 同样不覆盖已有的日期与时段：手工补过的信息优先保留。
          date: sql`coalesce(excluded.date, ${scheduledStreams.date})`,
          slot: sql`coalesce(excluded.slot, ${scheduledStreams.slot})`,
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

  const pruned = await pruneStaleSchedules(db, datasetId, now)

  return {
    upserted: plan.upcoming.length,
    live: plan.live.length,
    pruned,
    changed: plan.upcoming.length + plan.live.length + pruned > 0,
  }
}
