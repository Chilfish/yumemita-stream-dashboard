/**
 * `scheduled_streams` 与 `streams` 对账。
 *
 * 表的定位是「只保留还没入库的未来场」，并且 key 规则统一：
 * 日期 + 时段已知时用自然键 `manual:<date>-<slot>`，时间未知时才用 `yt:<videoId>`。
 *
 * 两类清理：
 * - 已能在 `streams` 找到对应场次的日程行直接删除；
 * - `yt:` 行在拿到日期/时段后归一到自然键；同一条未来场的手工行与自动行合并成一行。
 *
 * 匹配优先级：`video_id` → 链接里的 video id → 成员 + JST 日期 + 时段。
 * 标题不参与删除，避免「ゲーム」「朝活」这类占位标题误伤。
 */
import { and, eq, gte, inArray } from 'drizzle-orm'
import type { Db } from '../../src/db/connection.ts'
import { scheduledStreams, streams } from '../../src/db/schema.ts'
import { matchSchedulesToStreams } from '../../src/lib/calendar.ts'
import {
  isScheduleSlot,
  jstDateKeyFrom,
  resolveScheduleTiming,
  scheduleNaturalKey,
  slotForJstTime,
  videoIdFromUrl,
} from '../../src/lib/schedule.ts'
import { isMemberOnly } from '../../src/lib/visibility.ts'
import type { CalendarEventInput } from '../../src/types/calendar.ts'
import { toIso } from '../../src/db/queries/shared.ts'

const MATCH_WINDOW_DAYS = 120
const DAY_MS = 86_400_000
const DELETE_BATCH = 200

export interface StreamRef {
  datasetId: string
  videoId: string
  title: string
  date: string | null
  startedAt: Date | string | null
  endedAt: Date | string | null
  availability: string | null
}

export interface ScheduleRef {
  datasetId: string
  eventKey: string
  videoId: string | null
  title: string
  url: string | null
  date: string | null
  slot: string | null
  scheduledAt: Date | string | null
  expectedMinutes: number | null
  availability: string | null
  cancelledAt: Date | string | null
  source: string
}

export type SchedulePruneReason = 'video' | 'url' | 'date-slot'

export interface SchedulePruneEntry {
  datasetId: string
  eventKey: string
  videoId: string
  reason: SchedulePruneReason
}

export interface ScheduleMergePatch {
  videoId?: string
  title?: string
  url?: string
  date?: string
  slot?: string
  scheduledAt?: Date
  expectedMinutes?: number
}

export type ScheduleConsolidationAction = 'merge' | 'rename'

export interface ScheduleConsolidationEntry {
  datasetId: string
  eventKey: string
  targetEventKey: string
  action: ScheduleConsolidationAction
  videoId: string | null
  patch: ScheduleMergePatch
}

function toDate(value: Date | string | null): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function streamEvent(row: StreamRef): CalendarEventInput | null {
  const at = toIso(row.startedAt)
  if (!at) return null
  const date = row.date ?? jstDateKeyFrom(at)
  return {
    key: `stream:${row.videoId}`,
    datasetId: row.datasetId,
    videoId: row.videoId,
    title: row.title,
    at,
    date,
    slot: slotForJstTime(at),
    kind: null,
    timeTentative: false,
    endAt: toIso(row.endedAt),
    expectedMinutes: null,
    cancelled: false,
    hasStream: true,
    lastLiveAt: null,
    memberOnly: isMemberOnly(row.availability),
    source: 'stream',
    href: null,
    url: null,
  }
}

function scheduleEvent(row: ScheduleRef): CalendarEventInput | null {
  const timing = resolveScheduleTiming({
    date: row.date,
    slot: isScheduleSlot(row.slot) ? row.slot : null,
    scheduledAt: toIso(row.scheduledAt),
  })
  if (!timing.at && !timing.date) return null
  return {
    key: `schedule:${row.datasetId}:${row.eventKey}`,
    datasetId: row.datasetId,
    videoId: row.videoId,
    title: row.title,
    at: timing.at,
    date: timing.date,
    slot: timing.slot,
    kind: null,
    timeTentative: timing.timeTentative,
    endAt: null,
    expectedMinutes: row.expectedMinutes,
    cancelled: Boolean(row.cancelledAt),
    hasStream: false,
    lastLiveAt: null,
    memberOnly: isMemberOnly(row.availability),
    source: row.source === 'youtube' ? 'youtube' : 'manual',
    href: null,
    url: row.url,
  }
}

/** 纯函数：算出哪些日程行已经有对应的已入库场次。 */
export function planSchedulePrune(
  streamRows: StreamRef[],
  scheduleRows: ScheduleRef[],
): SchedulePruneEntry[] {
  const streamEvents = streamRows
    .map(streamEvent)
    .filter((event): event is CalendarEventInput => event !== null)
  const streamKeys = new Set(streamRows.map(row => `${row.datasetId}:${row.videoId}`))
  const planned = new Map<string, SchedulePruneEntry>()
  const fuzzy: { event: CalendarEventInput; row: ScheduleRef }[] = []

  for (const row of scheduleRows) {
    const direct = row.videoId ?? videoIdFromUrl(row.url)
    if (direct) {
      if (streamKeys.has(`${row.datasetId}:${direct}`)) {
        planned.set(`${row.datasetId}:${row.eventKey}`, {
          datasetId: row.datasetId,
          eventKey: row.eventKey,
          videoId: direct,
          reason: row.videoId ? 'video' : 'url',
        })
      }
      // ID / 链接指向的视频还没入库时，不按时间猜，保留原行。
      continue
    }
    if (row.cancelledAt) continue
    const event = scheduleEvent(row)
    if (event) fuzzy.push({ event, row })
  }

  if (fuzzy.length > 0) {
    const matches = matchSchedulesToStreams(streamEvents, fuzzy.map(item => item.event))
    const rowByKey = new Map(fuzzy.map(item => [item.event.key, item.row]))
    for (const [key, matched] of matches) {
      const row = rowByKey.get(key)
      if (!row || !matched.videoId) continue
      planned.set(`${row.datasetId}:${row.eventKey}`, {
        datasetId: row.datasetId,
        eventKey: row.eventKey,
        videoId: matched.videoId,
        reason: 'date-slot',
      })
    }
  }

  return [...planned.values()]
}

/** 已知日期 + 时段时的统一主键；与 `manual:<date>-<slot>` 同源。 */
function naturalEventKey(row: ScheduleRef): string | null {
  const timing = resolveScheduleTiming({
    date: row.date,
    slot: isScheduleSlot(row.slot) ? row.slot : null,
    scheduledAt: toIso(row.scheduledAt),
  })
  return scheduleNaturalKey(timing.date, timing.slot)
}

/**
 * 纯函数：把 `yt:` 行归一到统一格式。
 * - 已有同日同时段或同 video id 的手工行时，合并到手工行（保留自然键）；
 * - 没有手工行但日期/时段已知时，直接把 `yt:` 改名为自然键；
 * - 时间未知或目标键已被另一条视频占用时不动。
 */
export function planScheduleConsolidation(rows: ScheduleRef[]): ScheduleConsolidationEntry[] {
  const byKey = new Map(rows.map(row => [row.eventKey, row]))
  const naturalTargets = new Map<string, ScheduleRef>()
  const manualByVideo = new Map<string, ScheduleRef>()

  for (const row of rows) {
    if (!row.eventKey.startsWith('manual:')) continue
    const key = naturalEventKey(row)
    if (key) naturalTargets.set(key, row)
    const videoId = row.videoId ?? videoIdFromUrl(row.url)
    if (videoId) manualByVideo.set(`${row.datasetId}:${videoId}`, row)
  }

  const planned: ScheduleConsolidationEntry[] = []
  const reserved = new Set<string>()

  for (const row of rows) {
    if (!row.eventKey.startsWith('yt:')) continue
    const key = naturalEventKey(row)
    const target = (row.videoId
      ? manualByVideo.get(`${row.datasetId}:${row.videoId}`)
      : undefined) ?? (key ? naturalTargets.get(key) : undefined)

    if (target && target.eventKey !== row.eventKey) {
      const patch: ScheduleMergePatch = {}
      if (target.videoId == null && row.videoId) patch.videoId = row.videoId
      if (!target.title.trim() && row.title.trim()) patch.title = row.title
      if (!target.url && row.url) patch.url = row.url
      if (target.date == null && row.date) patch.date = row.date
      if (target.slot == null && row.slot) patch.slot = row.slot
      const scheduledAt = toDate(row.scheduledAt)
      if (target.scheduledAt == null && scheduledAt) patch.scheduledAt = scheduledAt
      if (target.expectedMinutes == null && row.expectedMinutes != null)
        patch.expectedMinutes = row.expectedMinutes

      planned.push({
        datasetId: row.datasetId,
        eventKey: row.eventKey,
        targetEventKey: target.eventKey,
        action: 'merge',
        videoId: row.videoId,
        patch,
      })
      continue
    }

    if (!key || byKey.has(key) || reserved.has(key)) continue
    reserved.add(key)
    planned.push({
      datasetId: row.datasetId,
      eventKey: row.eventKey,
      targetEventKey: key,
      action: 'rename',
      videoId: row.videoId,
      patch: {},
    })
  }

  return planned
}

function chunk<T>(values: T[], size: number): T[][] {
  const parts: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    parts.push(values.slice(index, index + size))
  }
  return parts
}

const scheduleColumns = {
  datasetId: scheduledStreams.datasetId,
  eventKey: scheduledStreams.eventKey,
  videoId: scheduledStreams.videoId,
  title: scheduledStreams.title,
  url: scheduledStreams.url,
  date: scheduledStreams.date,
  slot: scheduledStreams.slot,
  scheduledAt: scheduledStreams.scheduledAt,
  expectedMinutes: scheduledStreams.expectedMinutes,
  availability: scheduledStreams.availability,
  cancelledAt: scheduledStreams.cancelledAt,
  source: scheduledStreams.source,
}

/** 删除已经有对应 `streams` 行的日程；`dryRun` 时只返回计划。 */
export async function pruneMatchedSchedules(
  db: Db,
  datasetId: string,
  now: Date = new Date(),
  options: { dryRun?: boolean } = {},
): Promise<SchedulePruneEntry[]> {
  const cutoff = new Date(now.getTime() - MATCH_WINDOW_DAYS * DAY_MS)
  const [streamRows, scheduleRows] = await Promise.all([
    db
      .select({
        datasetId: streams.datasetId,
        videoId: streams.videoId,
        title: streams.title,
        date: streams.date,
        startedAt: streams.startedAt,
        endedAt: streams.endedAt,
        availability: streams.availability,
      })
      .from(streams)
      .where(and(eq(streams.datasetId, datasetId), gte(streams.startedAt, cutoff))),
    db
      .select(scheduleColumns)
      .from(scheduledStreams)
      .where(eq(scheduledStreams.datasetId, datasetId)),
  ])

  const plan = planSchedulePrune(streamRows, scheduleRows)
  if (options.dryRun || plan.length === 0) return plan

  for (const part of chunk(plan.map(entry => entry.eventKey), DELETE_BATCH)) {
    await db.delete(scheduledStreams).where(and(
      eq(scheduledStreams.datasetId, datasetId),
      inArray(scheduledStreams.eventKey, part),
    ))
  }
  return plan
}

/** 把 `yt:` 行归一到自然键，并合并同一条未来场的重复记录。 */
export async function normalizeScheduleKeys(
  db: Db,
  datasetId: string,
  now: Date = new Date(),
  options: { dryRun?: boolean } = {},
): Promise<ScheduleConsolidationEntry[]> {
  const rows = await db
    .select(scheduleColumns)
    .from(scheduledStreams)
    .where(eq(scheduledStreams.datasetId, datasetId))

  const plan = planScheduleConsolidation(rows)
  if (options.dryRun || plan.length === 0) return plan

  for (const entry of plan) {
    if (entry.action === 'rename') {
      await db
        .update(scheduledStreams)
        .set({ eventKey: entry.targetEventKey, updatedAt: now })
        .where(and(
          eq(scheduledStreams.datasetId, datasetId),
          eq(scheduledStreams.eventKey, entry.eventKey),
        ))
      continue
    }

    const patch: Partial<typeof scheduledStreams.$inferInsert> = { updatedAt: now }
    if (entry.patch.title !== undefined) patch.title = entry.patch.title
    if (entry.patch.url !== undefined) patch.url = entry.patch.url
    if (entry.patch.date !== undefined) patch.date = entry.patch.date
    if (entry.patch.slot !== undefined) patch.slot = entry.patch.slot
    if (entry.patch.scheduledAt !== undefined) patch.scheduledAt = entry.patch.scheduledAt
    if (entry.patch.expectedMinutes !== undefined)
      patch.expectedMinutes = entry.patch.expectedMinutes

    await db
      .update(scheduledStreams)
      .set(patch)
      .where(and(
        eq(scheduledStreams.datasetId, datasetId),
        eq(scheduledStreams.eventKey, entry.targetEventKey),
      ))

    // 先删来源行释放 `(dataset_id, video_id)` 唯一索引，再补 video id。
    await db.delete(scheduledStreams).where(and(
      eq(scheduledStreams.datasetId, datasetId),
      eq(scheduledStreams.eventKey, entry.eventKey),
    ))

    if (entry.patch.videoId) {
      await db
        .update(scheduledStreams)
        .set({ videoId: entry.patch.videoId, updatedAt: now })
        .where(and(
          eq(scheduledStreams.datasetId, datasetId),
          eq(scheduledStreams.eventKey, entry.targetEventKey),
        ))
    }
  }

  return plan
}
