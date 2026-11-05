import { and, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import { runBatch } from "@/db/batch";
import type { Db } from "@/db/connection";
import { scheduledStreams, streams } from "@/db/schema";
import {
  addDays,
  buildCalendarEvents,
} from "@/lib/calendar";
import { streamPath } from "@/lib/routes";
import { isMemberOnly } from "@/lib/visibility";
import type {
  CalendarEventInput,
  CalendarMember,
  CalendarPageData,
  CalendarWindow,
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

/**
 * 日历读取：一次取回窗口内的已结束场次与未来日程，在 JS 里合并。
 * 不读 pack、不碰 insights；状态由 `buildCalendarEvents` 按 `now` 派生。
 */
export async function getCalendarData(
  db: Db,
  options: GetCalendarDataOptions,
): Promise<CalendarPageData> {
  const now = options.now ?? new Date();

  const fromTime = new Date(`${options.from}T00:00:00+09:00`);
  const toTime = new Date(`${addDays(options.to, 1)}T00:00:00+09:00`);

  const streamRowsQuery = db
    .select({
      datasetId: streams.datasetId,
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
        options.datasetId ? eq(streams.datasetId, options.datasetId) : undefined,
        gte(streams.date, options.from),
        lte(streams.date, options.to),
      ),
    )
    .orderBy(streams.startedAt)

  const scheduleRowsQuery = db
    .select({
      datasetId: scheduledStreams.datasetId,
      eventKey: scheduledStreams.eventKey,
      videoId: scheduledStreams.videoId,
      title: scheduledStreams.title,
      url: scheduledStreams.url,
      scheduledAt: scheduledStreams.scheduledAt,
      expectedMinutes: scheduledStreams.expectedMinutes,
      cancelledAt: scheduledStreams.cancelledAt,
      availability: scheduledStreams.availability,
      source: scheduledStreams.source,
      lastLiveAt: scheduledStreams.lastLiveAt,
    })
    .from(scheduledStreams)
    .where(
      and(
        options.datasetId ? eq(scheduledStreams.datasetId, options.datasetId) : undefined,
        or(
          and(
            gte(scheduledStreams.scheduledAt, fromTime),
            lt(scheduledStreams.scheduledAt, toTime),
          ),
          isNull(scheduledStreams.scheduledAt),
        ),
      ),
    )
    .orderBy(scheduledStreams.scheduledAt)

  let members: CalendarMember[]
  let streamRows: Awaited<typeof streamRowsQuery>
  let scheduleRows: Awaited<typeof scheduleRowsQuery>

  if (options.members) {
    members = options.members;
    [streamRows, scheduleRows] = await Promise.all([streamRowsQuery, scheduleRowsQuery]);
  }
  else {
    const [datasetRows, rows, schedules] = await runBatch<[
      DatasetQueryRow[],
      Awaited<typeof streamRowsQuery>,
      Awaited<typeof scheduleRowsQuery>,
    ]>(db, [selectDatasetsQuery(db, undefined), streamRowsQuery, scheduleRowsQuery]);
    members = datasetRows.map(row => toMember(mapDataset(row)));
    streamRows = rows;
    scheduleRows = schedules;
  }

  const streamKeys = new Set<string>();
  const streamEvents: CalendarEventInput[] = [];

  for (const row of streamRows) {
    const at = toIso(row.startedAt)
      ?? (row.date ? `${row.date}T00:00:00+09:00` : null);
    if (!at) continue;

    if (row.videoId) streamKeys.add(`${row.datasetId}:${row.videoId}`);
    streamEvents.push({
      key: `stream:${row.videoId}`,
      datasetId: row.datasetId,
      videoId: row.videoId,
      title: row.title,
      at,
      endAt: toIso(row.endedAt),
      expectedMinutes: row.durationSec ? Math.ceil(row.durationSec / 60) : null,
      cancelled: false,
      hasStream: true,
      lastLiveAt: null,
      memberOnly: isMemberOnly(row.availability),
      source: "stream",
      href: streamPath(row.datasetId, row.videoId),
      url: row.url,
    });
  }

  const scheduleEvents: CalendarEventInput[] = scheduleRows.map(row => {
    const hasStream = row.videoId
      ? streamKeys.has(`${row.datasetId}:${row.videoId}`)
      : false;

    return {
      key: `schedule:${row.eventKey}`,
      datasetId: row.datasetId,
      videoId: row.videoId,
      title: row.title,
      at: toIso(row.scheduledAt),
      endAt: null,
      expectedMinutes: row.expectedMinutes,
      cancelled: Boolean(row.cancelledAt),
      hasStream,
      lastLiveAt: toIso(row.lastLiveAt),
      memberOnly: isMemberOnly(row.availability),
      source: row.source === "youtube" ? "youtube" : "manual",
      href: hasStream && row.videoId ? streamPath(row.datasetId, row.videoId) : null,
      url: row.url,
    };
  });

  return {
    members,
    events: buildCalendarEvents({ streams: streamEvents, schedules: scheduleEvents, members, now }),
    now: now.toISOString(),
    window: options.window,
  };
}
