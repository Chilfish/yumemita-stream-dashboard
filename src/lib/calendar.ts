import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarEventState,
  CalendarMember,
  CalendarParams,
  CalendarViewMode,
  CalendarWindow,
} from "@/types/calendar";

/**
 * 日历的日期一律按 JST 自然日分组。`at` 是 ISO 时刻，分组时不能直接切字符串，
 * 否则 23:59 JST 会被归到 UTC 的次日。
 */

const JST = "Asia/Tokyo";
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DEFAULT_EXPECTED_MINUTES = 180;
const LIVE_GRACE_MINUTES = 120;
const LIVE_MAX_HOURS = 12;
const LIVE_CHECK_HOURS = 24;
const PRE_START_MINUTES = 15;

const dateKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: JST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"] as const;

export interface CalendarCell {
  /** `YYYY-MM-DD`，按 JST 自然日。 */
  date: string;
  inMonth: boolean;
  isToday: boolean;
}

export interface CalendarWeek {
  days: CalendarCell[];
}

export function jstDateKey(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dateKeyFormat.format(date);
}

export function jstMonthKey(value: string | Date | null | undefined): string | null {
  const key = jstDateKey(value);
  return key ? key.slice(0, 7) : null;
}

export function currentJstMonth(now: Date): string {
  return jstMonthKey(now) ?? "1970-01";
}

export function currentJstDay(now: Date): string {
  return jstDateKey(now) ?? "1970-01-01";
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthIndex - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [year, monthIndex] = month.split("-").map(Number);
  return `${year} 年 ${monthIndex} 月`;
}

export function monthDayLabel(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${month} 月 ${day} 日`;
}

export function weekdayLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `周${weekdayLabels[weekday]}`;
}

export function relativeDayLabel(date: string, now: Date): string {
  const today = currentJstDay(now);
  if (date === today) return "今天";
  if (date === addDays(today, 1)) return "明天";
  return `${monthDayLabel(date)} · ${weekdayLabel(date)}`;
}

/** 议程列表的日头：今天 / 明天时补上日期，其余只给一次日期与星期。 */
export function agendaDayLabel(date: string, now: Date): string {
  const today = currentJstDay(now);
  const day = `${monthDayLabel(date)} · ${weekdayLabel(date)}`;
  if (date === today) return `今天 · ${day}`;
  if (date === addDays(today, 1)) return `明天 · ${day}`;
  return day;
}

export function addDays(date: string, delta: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return utcDateKey(Date.UTC(year, month - 1, day) + delta * DAY_MS);
}

function utcDateKey(time: number): string {
  const date = new Date(time);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** 月份闭区间，`from` 是当月 1 日，`to` 是当月最后一天。 */
export function monthRange(month: string): { from: string; to: string; next: string } {
  const [year, monthIndex] = month.split("-").map(Number);
  const next = shiftMonth(month, 1);
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, "0")}`,
    next,
  };
}

export function calendarWindow(month: string, back = 6, forward = 3): CalendarWindow {
  return { start: shiftMonth(month, -back), end: shiftMonth(month, forward) };
}

export function isMonthInWindow(month: string, window: CalendarWindow): boolean {
  return month >= window.start && month <= window.end;
}

/** 周日开始的月网格，补齐前后整周。 */
export function buildMonthGrid(month: string, now: Date): CalendarWeek[] {
  const [year, monthIndex] = month.split("-").map(Number);
  const first = Date.UTC(year, monthIndex - 1, 1);
  const last = Date.UTC(year, monthIndex, 0);
  const start = first - new Date(first).getUTCDay() * DAY_MS;
  const end = last + (6 - new Date(last).getUTCDay()) * DAY_MS;
  const today = currentJstDay(now);
  const weeks: CalendarWeek[] = [];

  for (let cursor = start; cursor <= end; cursor += 7 * DAY_MS) {
    const days: CalendarCell[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const date = utcDateKey(cursor + offset * DAY_MS);
      days.push({
        date,
        inMonth: date.startsWith(month),
        isToday: date === today,
      });
    }
    weeks.push({ days });
  }

  return weeks;
}

export function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const grouped = new Map<string, CalendarEvent[]>();

  for (const event of events) {
    const date = jstDateKey(event.at);
    if (!date) continue;
    const bucket = grouped.get(date) ?? [];
    bucket.push(event);
    grouped.set(date, bucket);
  }

  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  }

  return grouped;
}

export function undatedEvents(events: CalendarEvent[]): CalendarEvent[] {
  return events.filter(event => event.state === "undated");
}

export function upcomingEvents(
  events: CalendarEvent[],
  now: Date,
  days = 7,
): CalendarEvent[] {
  const nowMs = now.getTime();
  const end = nowMs + days * DAY_MS;

  return events
    .filter(event => {
      if (event.state !== "upcoming" && event.state !== "live") return false;
      if (!event.at) return false;
      const at = Date.parse(event.at);
      if (!Number.isFinite(at)) return false;
      // 已经开播但还没结束的也留在「接下来」里，排在最前。
      return at >= nowMs - LIVE_MAX_HOURS * HOUR_MS && at <= end;
    })
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}

export function deriveCalendarEventState(
  event: Pick<CalendarEvent, "cancelled" | "hasStream" | "at" | "expectedMinutes" | "lastLiveAt">,
  now: Date,
): CalendarEventState {
  if (event.cancelled) return "cancelled";
  if (event.hasStream) return "done";

  const nowMs = now.getTime();
  const lastLive = event.lastLiveAt ? Date.parse(event.lastLiveAt) : Number.NaN;
  if (Number.isFinite(lastLive) && nowMs - lastLive <= LIVE_CHECK_HOURS * HOUR_MS) {
    return "live";
  }

  if (!event.at) return "undated";
  const start = Date.parse(event.at);
  if (!Number.isFinite(start)) return "undated";

  const expectedMinutes = Math.min(
    Math.max(event.expectedMinutes ?? DEFAULT_EXPECTED_MINUTES, 15),
    LIVE_MAX_HOURS * 60,
  );
  const windowEnd = Math.min(
    start + (expectedMinutes + LIVE_GRACE_MINUTES) * 60_000,
    start + LIVE_MAX_HOURS * HOUR_MS,
  );

  if (nowMs >= start - PRE_START_MINUTES * 60_000 && nowMs <= windowEnd) return "live";
  if (nowMs < start) return "upcoming";
  return "pending";
}

const SOURCE_PRIORITY: Record<CalendarEventInput["source"], number> = {
  stream: 0,
  youtube: 1,
  manual: 2,
};

export interface BuildCalendarInput {
  streams: CalendarEventInput[];
  schedules: CalendarEventInput[];
  members: CalendarMember[];
  now: Date;
}

/**
 * 合并已结束场次与未来日程。同一个 video_id 只保留一条：
 * `streams` 优先于自动同步，自动同步优先于手工行。
 */
export function buildCalendarEvents(input: BuildCalendarInput): CalendarEvent[] {
  const streamKeys = new Set<string>();
  for (const event of input.streams) {
    if (event.videoId) streamKeys.add(`${event.datasetId}:${event.videoId}`);
  }

  const seenSchedules = new Set<string>();
  const schedules = [...input.schedules]
    .sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source])
    .filter(event => {
      if (!event.videoId) return true;
      const key = `${event.datasetId}:${event.videoId}`;
      if (streamKeys.has(key) || seenSchedules.has(key)) return false;
      seenSchedules.add(key);
      return true;
    });

  const memberById = new Map(input.members.map(member => [member.id, member]));

  return [...input.streams, ...schedules]
    .map(event => {
      const member = memberById.get(event.datasetId);
      return {
        ...event,
        state: deriveCalendarEventState(event, input.now),
        memberLabel: member?.label ?? event.datasetId,
        color: member?.color ?? "var(--member-color)",
      } satisfies CalendarEvent;
    })
    .sort((a, b) => {
      const byTime = (a.at ?? "9999-12-31T23:59:59+09:00")
        .localeCompare(b.at ?? "9999-12-31T23:59:59+09:00");
      return byTime !== 0 ? byTime : a.memberLabel.localeCompare(b.memberLabel);
    });
}

export function parseCalendarParams(
  searchParams: URLSearchParams,
  fallbackMonth: string,
): CalendarParams {
  const monthParam = searchParams.get("month");
  const dayParam = searchParams.get("day");
  const viewParam = searchParams.get("view");
  const membersParam = searchParams.get("members");
  const day = isDayKey(dayParam) ? dayParam : null;

  return {
    // 只带 `?day=` 时以那一天所在月份为准，避免选中日不在网格里。
    month: isMonthKey(monthParam) ? monthParam : (day ? day.slice(0, 7) : fallbackMonth),
    day,
    members: membersParam
      ? [...new Set(membersParam.split(",").map(value => value.trim()).filter(Boolean))]
      : [],
    view: viewParam === "month" || viewParam === "agenda" ? viewParam : null,
  };
}

export function writeCalendarParams(
  current: URLSearchParams,
  next: CalendarParams,
  defaultMonth: string,
): URLSearchParams {
  const params = new URLSearchParams(current);

  if (next.month === defaultMonth) params.delete("month");
  else params.set("month", next.month);

  if (next.day) params.set("day", next.day);
  else params.delete("day");

  if (next.members.length > 0) params.set("members", next.members.join(","));
  else params.delete("members");

  if (next.view) params.set("view", next.view);
  else params.delete("view");

  return params;
}

export function isCalendarViewMode(value: unknown): value is CalendarViewMode {
  return value === "month" || value === "agenda";
}
