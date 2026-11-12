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
import {
  freeScheduleEventKey,
  isScheduleSlot,
  jstDateKeyFrom,
  scheduleNaturalKey,
  slotForJstTime,
  videoIdFromUrl,
} from '../../src/lib/schedule.ts'
import type { ChannelEntry } from './update-plan.ts'
import { normalizeScheduleKeys } from './schedule-match.ts'

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
    const date = jstDateKeyFrom(scheduledAt)
    const slot = slotForJstTime(scheduledAt)
    upcoming.push({
      videoId: entry.id,
      // 日期 + 时段已知时统一用自然键；时间未知才退回 yt。
      eventKey: scheduleNaturalKey(date, slot) ?? `yt:${entry.id}`,
      title: entry.title?.trim() || '未命名直播',
      url: `https://www.youtube.com/watch?v=${entry.id}`,
      date,
      slot,
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
  normalized: number
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

interface ExistingScheduleRow {
  eventKey: string
  videoId: string | null
  url: string | null
  date: string | null
  slot: string | null
  scheduledAt: Date | null
}

function minutesBetween(left: Date | null, right: Date | null): number | null {
  if (!left || !right) return null
  return Math.abs(left.getTime() - right.getTime()) / 60_000
}

/**
 * 逐条写入未来场。已有行就地更新，主键保持稳定：
 * 手工自然键行不会被自动同步接管成 `yt:`，`yt:` 行拿到日期后再统一归一。
 *
 * 同一成员同日同时段有多场时按「未认领 + 开播时间最近」选目标行，
 * 不会再无条件认领自然键、把另一场的 video id 冲掉。
 */
async function upsertScheduleEntries(
  db: Db,
  datasetId: string,
  entries: PlannedScheduleEntry[],
  now: Date,
): Promise<void> {
  if (entries.length === 0) return

  const rows = await db
    .select({
      eventKey: scheduledStreams.eventKey,
      videoId: scheduledStreams.videoId,
      url: scheduledStreams.url,
      date: scheduledStreams.date,
      slot: scheduledStreams.slot,
      scheduledAt: scheduledStreams.scheduledAt,
    })
    .from(scheduledStreams)
    .where(eq(scheduledStreams.datasetId, datasetId))

  const byKey = new Map<string, ExistingScheduleRow>(rows.map(row => [row.eventKey, row]))
  const byVideo = new Map<string, ExistingScheduleRow>(
    rows.filter(row => row.videoId).map(row => [row.videoId as string, row]),
  )
  const claimed = new Set<string>()
  const bySlot = new Map<string, ExistingScheduleRow[]>()
  for (const row of rows) {
    const anchor = row.date && isScheduleSlot(row.slot) ? `${row.date}:${row.slot}` : null
    if (!anchor) continue
    const bucket = bySlot.get(anchor)
    if (bucket) bucket.push(row)
    else bySlot.set(anchor, [row])
  }

  for (const entry of entries) {
    const byUrlId = rows.find(row => !row.videoId && videoIdFromUrl(row.url) === entry.videoId)
    const byVideoTarget = byVideo.get(entry.videoId) ?? byUrlId
    // 同槽里没被本轮认领、且没有挂着别的视频的行；取开播时间最近的一条。
    const slotTarget = entry.date && isScheduleSlot(entry.slot)
      ? (bySlot.get(`${entry.date}:${entry.slot}`) ?? [])
          .filter(row => !claimed.has(row.eventKey))
          .filter(row => !row.videoId || row.videoId === entry.videoId)
          .sort((a, b) => {
            const left = minutesBetween(entry.scheduledAt, a.scheduledAt)
            const right = minutesBetween(entry.scheduledAt, b.scheduledAt)
            if (left != null && right != null && left !== right) return left - right
            if (left != null && right == null) return -1
            if (left == null && right != null) return 1
            return a.eventKey.localeCompare(b.eventKey)
          })[0]
      : undefined

    const target = byVideoTarget ?? slotTarget

    if (target) {
      claimed.add(target.eventKey)
      await db
        .update(scheduledStreams)
        .set({
          videoId: entry.videoId,
          title: entry.title,
          url: entry.url,
          lastSeenAt: now,
          updatedAt: now,
          // 频道列表不含共演信息：只动时间类字段，保留手工登记的参与者。
          scheduledAt: sql`coalesce(${entry.scheduledAt}, ${scheduledStreams.scheduledAt})`,
          date: sql`coalesce(${entry.date}, ${scheduledStreams.date})`,
          slot: sql`coalesce(${entry.slot}, ${scheduledStreams.slot})`,
          expectedMinutes: sql`coalesce(${entry.expectedMinutes}, ${scheduledStreams.expectedMinutes})`,
        })
        .where(and(
          eq(scheduledStreams.datasetId, datasetId),
          eq(scheduledStreams.eventKey, target.eventKey),
        ))
      continue
    }

    // 同一时段已有另一条视频时顺延到下一个空序号；没有日期/时段才退回 yt。
    const eventKey = entry.date && isScheduleSlot(entry.slot)
      ? freeScheduleEventKey(entry.date, entry.slot, byKey.keys())
      : `yt:${entry.videoId}`

    await db
      .insert(scheduledStreams)
      .values({
        datasetId,
        eventKey,
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
      })
      .onConflictDoUpdate({
        target: [scheduledStreams.datasetId, scheduledStreams.eventKey],
        set: {
          videoId: sql`excluded.video_id`,
          title: sql`excluded.title`,
          url: sql`excluded.url`,
          lastSeenAt: sql`excluded.last_seen_at`,
          updatedAt: sql`excluded.updated_at`,
          scheduledAt: sql`coalesce(excluded.scheduled_at, ${scheduledStreams.scheduledAt})`,
          date: sql`coalesce(excluded.date, ${scheduledStreams.date})`,
          slot: sql`coalesce(excluded.slot, ${scheduledStreams.slot})`,
          expectedMinutes: sql`coalesce(excluded.expected_minutes, ${scheduledStreams.expectedMinutes})`,
        },
      })

    // 同一轮里后续条目要能看到刚写入的键，避免同一时段互相覆盖。
    const written: ExistingScheduleRow = {
      eventKey,
      videoId: entry.videoId,
      url: entry.url,
      date: entry.date,
      slot: entry.slot,
      scheduledAt: entry.scheduledAt,
    }
    byKey.set(eventKey, written)
    byVideo.set(entry.videoId, written)
    if (entry.date && isScheduleSlot(entry.slot)) {
      const anchor = `${entry.date}:${entry.slot}`
      bySlot.set(anchor, [...(bySlot.get(anchor) ?? []), written])
    }
    claimed.add(eventKey)
  }
}

export async function syncScheduleFromChannel(
  db: Db,
  datasetId: string,
  entries: ChannelEntry[],
  options: { now?: Date; knownIds?: Set<string> } = {},
): Promise<ScheduleSyncResult> {
  const now = options.now ?? new Date()
  const plan = planScheduleEntries(entries, { knownIds: options.knownIds })

  await upsertScheduleEntries(db, datasetId, plan.upcoming, now)

  if (plan.live.length > 0) {
    await db
      .update(scheduledStreams)
      .set({ lastLiveAt: now, lastSeenAt: now, updatedAt: now })
      .where(and(
        eq(scheduledStreams.datasetId, datasetId),
        inArray(scheduledStreams.videoId, plan.live),
      ))
  }

  // 频道列表可能先拿到 videoId，手工行后补了日期；归一到自然键再清理。
  const normalized = (await normalizeScheduleKeys(db, datasetId, now)).length
  const pruned = await pruneStaleSchedules(db, datasetId, now)

  return {
    upserted: plan.upcoming.length,
    live: plan.live.length,
    normalized,
    pruned,
    changed: plan.upcoming.length + plan.live.length + normalized + pruned > 0,
  }
}
