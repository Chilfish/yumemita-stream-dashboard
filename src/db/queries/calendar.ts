import { and, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import { runBatch } from "@/db/batch";
import type { Db } from "@/db/connection";
import { scheduledStreams, streams } from "@/db/schema";
import { classifyTitle, isContentType } from "@/lib/classify";
import {
  addDays,
  buildCalendarEvents,
  buildDayPlan,
  deriveCalendarEventState,
  jstDateKey,
  matchSchedulesToStreams,
} from "@/lib/calendar";
import { streamPath } from "@/lib/routes";
import {
  isScheduleSlot,
  resolveScheduleTiming,
  slotForJstTime,
  videoIdFromUrl,
} from "@/lib/schedule";
import { isMemberOnly } from "@/lib/visibility";
import { involvesMember } from "./streams";
import type {
  AdminScheduleItem,
  CalendarEventInput,
  CalendarMember,
  CalendarPageData,
  CalendarWindow,
  DayPlan,
  ScheduleSlot,
} from "@/types/calendar";
import { mapDataset, selectDatasetsQuery, type DatasetQueryRow } from "./datasets";
import { toIso } from "./shared";

export interface GetCalendarDataOptions {
  /** JST 日期键，闭区间。 */
  from: string;
  to: string;
  window: CalendarWindow;
  datasetId?: string;
  /** 页面已经取过成员时传进来，省一条查询。 */
  members?: CalendarMember[];
  now?: Date;
}

function toMember(row: ReturnType<typeof mapDataset>): CalendarMember {
  return {
    id: row.id,
    label: row.label,
    color: row.color,
    avatar: row.avatarKey,
    streamCount: row.streamCount,
  };
}

export function buildStreamQueries(db: Db, options: { from: string; to: string; datasetId?: string }) {
  return db
    .select({
      datasetId: streams.datasetId,
      participants: streams.participants,
      videoId: streams.videoId,
      title: streams.title,
      url: streams.url,
      date: streams.date,
      startedAt: streams.startedAt,
      endedAt: streams.endedAt,
      durationSec: streams.durationSec,
      availability: streams.availability,
    })
    .from(streams)
    .where(
      and(
        options.datasetId ? involvesMember(options.datasetId) : undefined,
        gte(streams.date, options.from),
        lte(streams.date, options.to),
      ),
    )
    .orderBy(streams.startedAt)
}

export function buildScheduleQueries(
  db: Db,
  options: { from: string; to: string; datasetId?: string; includeUndated?: boolean },
) {
  const fromTime = new Date(`${options.from}T00:00:00+09:00`);
  const toTime = new Date(`${addDays(options.to, 1)}T00:00:00+09:00`);

  return db
    .select({
      datasetId: scheduledStreams.datasetId,
      eventKey: scheduledStreams.eventKey,
      videoId: scheduledStreams.videoId,
      title: scheduledStreams.title,
      url: scheduledStreams.url,
      date: scheduledStreams.date,
      slot: scheduledStreams.slot,
      kind: scheduledStreams.kind,
      scheduledAt: scheduledStreams.scheduledAt,
      expectedMinutes: scheduledStreams.expectedMinutes,
      cancelledAt: scheduledStreams.cancelledAt,
      availability: scheduledStreams.availability,
      participants: scheduledStreams.participants,
      source: scheduledStreams.source,
      note: scheduledStreams.note,
      lastLiveAt: scheduledStreams.lastLiveAt,
      updatedAt: scheduledStreams.updatedAt,
    })
    .from(scheduledStreams)
    .where(
      and(
        options.datasetId ? eq(scheduledStreams.datasetId, options.datasetId) : undefined,
        or(
          and(
            gte(scheduledStreams.date, options.from),
            lte(scheduledStreams.date, options.to),
          ),
          and(
            isNull(scheduledStreams.date),
            gte(scheduledStreams.scheduledAt, fromTime),
            lt(scheduledStreams.scheduledAt, toTime),
          ),
          options.includeUndated === false
            ? undefined
            : and(
              isNull(scheduledStreams.date),
              isNull(scheduledStreams.scheduledAt),
            ),
        ),
      ),
    )
    .orderBy(scheduledStreams.scheduledAt);
}

export type StreamQueryRow = Awaited<ReturnType<typeof buildStreamQueries>>[number];
export type ScheduleQueryRow = Awaited<ReturnType<typeof buildScheduleQueries>>[number];

function mapStreamEvent(row: StreamQueryRow): CalendarEventInput | null {
  const startedAt = toIso(row.startedAt);
  const date = row.date ?? jstDateKey(startedAt);
  const at = startedAt ?? (date ? `${date}T00:00:00+09:00` : null);
  if (!at) return null;

  return {
    key: `stream:${row.videoId}`,
    datasetId: row.datasetId,
    participantIds: row.participants ?? [],
    videoId: row.videoId,
    title: row.title,
    at,
    date,
    slot: slotForJstTime(startedAt),
    kind: classifyTitle(row.title).key,
    timeTentative: false,
    endAt: toIso(row.endedAt),
    expectedMinutes: row.durationSec ? Math.ceil(row.durationSec / 60) : null,
    cancelled: false,
    hasStream: true,
    lastLiveAt: null,
    memberOnly: isMemberOnly(row.availability),
    source: "stream",
    href: streamPath(row.datasetId, row.videoId),
    url: row.url,
  };
}

function mapScheduleEvent(row: ScheduleQueryRow, streamOwners: Map<string, string>): CalendarEventInput {
  const scheduledAt = toIso(row.scheduledAt);
  const timing = resolveScheduleTiming({
    date: row.date,
    slot: isScheduleSlot(row.slot) ? row.slot : null,
    scheduledAt,
  });
  const streamVideoId = row.videoId ?? videoIdFromUrl(row.url);
  // 同一条视频只存一条记录（跨 dataset 零重复），按 videoId 判断即可，
  // owner 用来决定链接落在谁的页面上。
  const streamOwner = streamVideoId ? streamOwners.get(streamVideoId) ?? null : null;
  const hasStream = streamOwner !== null;

  return {
    key: `schedule:${row.datasetId}:${row.eventKey}`,
    datasetId: row.datasetId,
    participantIds: row.participants ?? [],
    videoId: row.videoId,
    title: row.title,
    at: timing.at,
    date: timing.date,
    slot: timing.slot,
    kind: isContentType(row.kind)
      ? row.kind
      : (row.title.trim() ? classifyTitle(row.title).key : null),
    timeTentative: timing.timeTentative,
    endAt: null,
    expectedMinutes: row.expectedMinutes,
    cancelled: Boolean(row.cancelledAt),
    hasStream,
    lastLiveAt: toIso(row.lastLiveAt),
    memberOnly: isMemberOnly(row.availability),
    source: row.source === "youtube" ? "youtube" : "manual",
    href: streamOwner && streamVideoId
      ? streamPath(streamOwner, streamVideoId)
      : null,
    url: row.url,
  };
}

function streamOwnerMap(events: CalendarEventInput[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const event of events) {
    if (event.videoId) owners.set(event.videoId, event.datasetId);
  }
  return owners;
}

/**
 * 日历读取：一次取回窗口内的已结束场次与未来日程，在 JS 里合并。
 * 不读 pack、不碰 insights；状态由 `buildCalendarEvents` 按 `now` 派生。
 */
export async function getCalendarData(
  db: Db,
  options: GetCalendarDataOptions,
): Promise<CalendarPageData> {
  const now = options.now ?? new Date();
  const streamRowsQuery = buildStreamQueries(db, options);
  const scheduleRowsQuery = buildScheduleQueries(db, options);

  let members: CalendarMember[];
  let streamRows: StreamQueryRow[];
  let scheduleRows: ScheduleQueryRow[];

  if (options.members) {
    members = options.members;
    [streamRows, scheduleRows] = await Promise.all([streamRowsQuery, scheduleRowsQuery]);
  }
  else {
    const [datasetRows, rows, schedules] = await runBatch<[
      DatasetQueryRow[],
      StreamQueryRow[],
      ScheduleQueryRow[],
    ]>(db, [selectDatasetsQuery(db, undefined), streamRowsQuery, scheduleRowsQuery]);
    members = datasetRows.map(row => toMember(mapDataset(row)));
    streamRows = rows;
    scheduleRows = schedules;
  }

  const streamEvents = streamRows
    .map(mapStreamEvent)
    .filter((event): event is CalendarEventInput => event !== null);
  const owners = streamOwnerMap(streamEvents);
  const scheduleEvents = scheduleRows.map(row => mapScheduleEvent(row, owners));

  return {
    members,
    events: buildCalendarEvents({ streams: streamEvents, schedules: scheduleEvents, members, now }),
    now: now.toISOString(),
    window: options.window,
  };
}

/** 从已取回的日期窗口行组装今天 / 明天时间线，供首页 batch 复用。 */
export function buildDayPlanFromRows(
  streamRows: StreamQueryRow[],
  scheduleRows: ScheduleQueryRow[],
  members: CalendarMember[],
  now: Date,
  days = 2,
): DayPlan {
  const streamEvents = streamRows
    .map(mapStreamEvent)
    .filter((event): event is CalendarEventInput => event !== null);
  const owners = streamOwnerMap(streamEvents);
  const scheduleEvents = scheduleRows.map(row => mapScheduleEvent(row, owners));
  const events = buildCalendarEvents({ streams: streamEvents, schedules: scheduleEvents, members, now });

  return buildDayPlan(events, now, days, members);
}

/** 组首页的「今天 + 明天」面板：复用同一套匹配与状态派生。 */
export async function getDayPlan(db: Db, now = new Date(), days = 2): Promise<DayPlan> {
  const today = jstDateKey(now) ?? `${now.getUTCFullYear()}-01-01`;
  const options = { from: today, to: addDays(today, Math.max(0, days - 1)) };

  const [datasetRows, streamRows, scheduleRows] = await runBatch<[
    DatasetQueryRow[],
    StreamQueryRow[],
    ScheduleQueryRow[],
  ]>(db, [
    selectDatasetsQuery(db, undefined),
    buildStreamQueries(db, options),
    buildScheduleQueries(db, { ...options, includeUndated: false }),
  ]);

  return buildDayPlanFromRows(
    streamRows,
    scheduleRows,
    datasetRows.map(row => toMember(mapDataset(row))),
    now,
    days,
  );
}

/** 管理端列表：返回原始日程行，并带上读取时匹配到的真实场次。 */
export async function getAdminScheduleList(
  db: Db,
  options: { from: string; to: string; datasetId?: string; includeUndated?: boolean },
): Promise<AdminScheduleItem[]> {
  const streamRowsQuery = buildStreamQueries(db, options);
  const scheduleRowsQuery = buildScheduleQueries(db, {
    ...options,
    includeUndated: options.includeUndated ?? false,
  });

  const [streamRows, scheduleRows] = await runBatch<[StreamQueryRow[], ScheduleQueryRow[]]>(db, [
    streamRowsQuery,
    scheduleRowsQuery,
  ]);

  const streamEvents = streamRows
    .map(mapStreamEvent)
    .filter((event): event is CalendarEventInput => event !== null);
  const owners = streamOwnerMap(streamEvents);
  const scheduleEvents = scheduleRows.map(row => mapScheduleEvent(row, owners));
  const matches = matchSchedulesToStreams(streamEvents, scheduleEvents);
  const now = new Date();

  return scheduleRows.map((row, index) => {
    const event = scheduleEvents[index] ?? mapScheduleEvent(row, owners);
    const matched = matches.get(event.key) ?? null;
    const state = deriveCalendarEventState(
      { ...event, hasStream: Boolean(matched) || event.hasStream },
      now,
    );

    return {
      datasetId: row.datasetId,
      eventKey: row.eventKey,
      participants: row.participants ?? [],
      videoId: row.videoId,
      title: row.title,
      url: row.url,
      date: event.date,
      slot: event.slot as ScheduleSlot | null,
      kind: event.kind,
      scheduledAt: toIso(row.scheduledAt),
      timeTentative: event.timeTentative,
      expectedMinutes: row.expectedMinutes,
      availability: row.availability,
      cancelled: Boolean(row.cancelledAt),
      note: row.note,
      source: event.source,
      state,
      matchedStream: matched?.videoId
        ? {
            videoId: matched.videoId,
            title: matched.title,
            href: streamPath(matched.datasetId, matched.videoId),
          }
        : null,
      updatedAt: toIso(row.updatedAt),
    } satisfies AdminScheduleItem;
  });
}
