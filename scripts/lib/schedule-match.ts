/**
 * 把读取期的手工日程匹配结果回填到 `scheduled_streams.superseded_by`。
 *
 * 精确 videoId 匹配由 ingest 直接写入；没有 videoId 的手工行按「成员 + 日期 + 时段」
 * 与真实场次匹配，逻辑复用 `src/lib/calendar.ts`，避免写入与读取两套规则。
 */
import { and, eq, gte, isNotNull, isNull, or } from 'drizzle-orm'
import type { Db } from '../../src/db/connection.ts'
import { scheduledStreams, streams } from '../../src/db/schema.ts'
import { matchSchedulesToStreams } from '../../src/lib/calendar.ts'
import {
  isScheduleSlot,
  jstDateKeyFrom,
  resolveScheduleTiming,
  slotForJstTime,
} from '../../src/lib/schedule.ts'
import { isMemberOnly } from '../../src/lib/visibility.ts'
import type { CalendarEventInput } from '../../src/types/calendar.ts'
import { toIso } from '../../src/db/queries/shared.ts'

const MATCH_WINDOW_DAYS = 120
const DAY_MS = 86_400_000

function streamEvent(row: {
  datasetId: string
  videoId: string
  title: string
  date: string | null
  startedAt: Date | string | null
  endedAt: Date | string | null
  availability: string | null
}): CalendarEventInput | null {
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

function scheduleEvent(row: {
  datasetId: string
  eventKey: string
  title: string
  date: string | null
  slot: string | null
  scheduledAt: Date | string | null
  availability: string | null
}): CalendarEventInput | null {
  const timing = resolveScheduleTiming({
    date: row.date,
    slot: isScheduleSlot(row.slot) ? row.slot : null,
    scheduledAt: toIso(row.scheduledAt),
  })
  if (!timing.at && !timing.date) return null
  return {
    key: `schedule:${row.datasetId}:${row.eventKey}`,
    datasetId: row.datasetId,
    videoId: null,
    title: row.title,
    at: timing.at,
    date: timing.date,
    slot: timing.slot,
    kind: null,
    timeTentative: timing.timeTentative,
    endAt: null,
    expectedMinutes: null,
    cancelled: false,
    hasStream: false,
    lastLiveAt: null,
    memberOnly: isMemberOnly(row.availability),
    source: 'manual',
    href: null,
    url: null,
  }
}

export async function backfillSupersededSchedules(
  db: Db,
  datasetId: string,
  now: Date = new Date(),
): Promise<number> {
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
      .select({
        datasetId: scheduledStreams.datasetId,
        eventKey: scheduledStreams.eventKey,
        title: scheduledStreams.title,
        date: scheduledStreams.date,
        slot: scheduledStreams.slot,
        scheduledAt: scheduledStreams.scheduledAt,
        availability: scheduledStreams.availability,
      })
      .from(scheduledStreams)
      .where(and(
        eq(scheduledStreams.datasetId, datasetId),
        eq(scheduledStreams.source, 'manual'),
        isNull(scheduledStreams.videoId),
        isNull(scheduledStreams.cancelledAt),
        isNull(scheduledStreams.supersededBy),
        or(
          isNotNull(scheduledStreams.date),
          isNotNull(scheduledStreams.scheduledAt),
        ),
      )),
  ])

  const streamEvents = streamRows
    .map(streamEvent)
    .filter((event): event is CalendarEventInput => event !== null)
  const scheduleEvents = scheduleRows
    .map(scheduleEvent)
    .filter((event): event is CalendarEventInput => event !== null)
  if (streamEvents.length === 0 || scheduleEvents.length === 0) return 0

  const matches = matchSchedulesToStreams(streamEvents, scheduleEvents)
  if (matches.size === 0) return 0

  const eventKeyByKey = new Map(scheduleRows.map(row => [
    `schedule:${row.datasetId}:${row.eventKey}`,
    row.eventKey,
  ]))
  let updated = 0
  for (const [key, matched] of matches) {
    const eventKey = eventKeyByKey.get(key)
    if (!eventKey || !matched.videoId) continue
    await db
      .update(scheduledStreams)
      .set({ supersededBy: matched.videoId, updatedAt: now })
      .where(and(
        eq(scheduledStreams.datasetId, datasetId),
        eq(scheduledStreams.eventKey, eventKey),
        isNull(scheduledStreams.supersededBy),
      ))
    updated += 1
  }
  return updated
}
