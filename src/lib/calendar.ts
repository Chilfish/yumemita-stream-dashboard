import { jstHour, slotForJstTime, videoIdFromUrl } from "@/lib/schedule";
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarEventState,
  CalendarMember,
  CalendarParams,
  CalendarViewMode,
  CalendarWindow,
  DayPlan,
  ScheduleSlot,
} from "@/types/calendar";

/**
 * 日历的日期一律按 JST 自然日分组。`at` 是 ISO 时刻，分组时不能直接切字符串，
 * 否则 23:59 JST 会被归到 UTC 的次日。
 */

const JST = "Asia/Tokyo";
const DAY_MS = 86_400_000;
// 结束时间不可预测，开播后最多保留 1 小时「直播中」，之后交给「待补录」等场次入库。
const LIVE_WINDOW_MINUTES = 60;
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

/** 按 JST 自然日切出今天 / 明天（或更多天）的时间线数据。 */
export function buildDayPlan(
  events: CalendarEvent[],
  now: Date,
  days = 2,
  members: CalendarMember[] = [],
): DayPlan {
  const today = currentJstDay(now);
  const dates = Array.from({ length: days }, (_, index) => addDays(today, index));

  return {
    now: now.toISOString(),
    members,
    days: dates.map((date, offset) => ({
      date,
      offset,
      events: events
        .filter(event => (event.date ?? jstDateKey(event.at)) === date)
        .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "")),
    })),
  };
}

export function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const grouped = new Map<string, CalendarEvent[]>();

  for (const event of events) {
    const date = event.date ?? jstDateKey(event.at);
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
      if (event.state === "live") return true;
      if (event.state !== "upcoming" || !event.at) return false;
      const at = Date.parse(event.at);
      return Number.isFinite(at) && at <= end;
    })
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}

/**
 * 直播判定：开播前 15 分钟到开播后 1 小时。
 * 结束时间不可预测，不再按预计时长推算；超过窗口后显示「待补录」，直到场次入库。
 */
export function isLive(
  event: Pick<CalendarEvent, "at" | "lastLiveAt">,
  now: Date,
): boolean {
  const nowMs = now.getTime();
  const windowMs = LIVE_WINDOW_MINUTES * 60_000;

  if (event.at) {
    const start = Date.parse(event.at);
    if (!Number.isFinite(start)) return false;
    return nowMs >= start - PRE_START_MINUTES * 60_000 && nowMs <= start + windowMs;
  }

  // 没有精确开播时间时，以频道检查时刻为起点，同样最多保留 1 小时。
  const lastLive = event.lastLiveAt ? Date.parse(event.lastLiveAt) : Number.NaN;
  return Number.isFinite(lastLive) && nowMs >= lastLive && nowMs - lastLive <= windowMs;
}

export function deriveCalendarEventState(
  event: Pick<CalendarEvent, "cancelled" | "hasStream" | "at" | "lastLiveAt">,
  now: Date,
): CalendarEventState {
  // 已入库的场次是事实，优先于日程上的取消标记：取消后仍然播出的场次应显示为已结束。
  if (event.hasStream) return "done";
  if (event.cancelled) return "cancelled";

  if (isLive(event, now)) return "live";

  if (!event.at) return "undated";
  const start = Date.parse(event.at);
  if (!Number.isFinite(start)) return "undated";

  if (now.getTime() < start) return "upcoming";
  return "pending";
}

const MATCH_CROSS_ANCHOR_MINUTES = 120;
const MATCH_TENTATIVE_SCORE = 500;

function eventAnchor(event: CalendarEventInput): string | null {
  const slot: ScheduleSlot | null = event.slot ?? slotForJstTime(event.at);
  const date = event.date ?? jstDateKey(event.at);
  if (!date || !slot) return null;

  // 晚场跨午夜：00:00–04:59 归到前一天，23:30 与次日 00:30 视为同一晚。
  let anchor = date;
  if (slot === "late" && event.at) {
    const hour = jstHour(event.at);
    if (hour != null && hour < 5) anchor = addDays(date, -1);
  }
  return `${event.datasetId}:${anchor}:${slot}`;
}

function minutesApart(a: CalendarEventInput, b: CalendarEventInput): number | null {
  if (!a.at || !b.at) return null;
  const left = Date.parse(a.at);
  const right = Date.parse(b.at);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return Math.abs(left - right) / 60_000;
}

/** 日程行自身的视频 id：优先显式字段，其次从链接里推。 */
export function scheduleVideoId(event: Pick<CalendarEventInput, "videoId" | "url">): string | null {
  return event.videoId ?? videoIdFromUrl(event.url);
}

/**
 * 把没有 videoId 的手工日程按「成员 + JST 日期 + 时段」匹配到真实事件。
 * 返回 `schedule.key -> 命中的事件`；命中的日程在日历里被隐藏，改显真实场次。
 */
export function matchSchedulesToStreams(
  streams: CalendarEventInput[],
  schedules: CalendarEventInput[],
): Map<string, CalendarEventInput> {
  const matches = new Map<string, CalendarEventInput>();
  const streamByVideo = new Map<string, CalendarEventInput>();
  const used = new Set<string>();
  // 按 key 排序后再分配，避免匹配结果依赖数据库返回顺序。
  const orderedSchedules = [...schedules].sort((a, b) => a.key.localeCompare(b.key));

  for (const stream of streams) {
    if (!stream.videoId) continue;
    streamByVideo.set(`${stream.datasetId}:${stream.videoId}`, stream);
  }

  for (const schedule of orderedSchedules) {
    if (schedule.cancelled) continue;
    const videoId = scheduleVideoId(schedule);
    if (!videoId) continue;
    const stream = streamByVideo.get(`${schedule.datasetId}:${videoId}`);
    if (!stream) continue;
    matches.set(schedule.key, stream);
    used.add(stream.key);
  }

  const realEvents = [
    ...streams,
    ...orderedSchedules.filter(event => event.source === "youtube" && !event.cancelled),
  ].sort((a, b) => a.key.localeCompare(b.key));

  for (const schedule of orderedSchedules) {
    // 已知 video id（含链接里带出的）就只认它，不再按时间猜，避免认领到另一场。
    if (schedule.cancelled || schedule.source !== "manual" || scheduleVideoId(schedule)) continue;
    if (matches.has(schedule.key)) continue;

    const anchor = eventAnchor(schedule);
    if (!anchor) continue;

    let best: { event: CalendarEventInput; score: number } | null = null;

    for (const candidate of realEvents) {
      if (candidate.key === schedule.key || candidate.datasetId !== schedule.datasetId) continue;
      if (used.has(candidate.key)) continue;

      const candidateAnchor = eventAnchor(candidate);
      if (!candidateAnchor) continue;

      let score: number | null = null;
      if (candidateAnchor === anchor) {
        score = minutesApart(schedule, candidate) ?? MATCH_TENTATIVE_SCORE;
      }
      else if (!schedule.timeTentative && !candidate.timeTentative) {
        const diff = minutesApart(schedule, candidate);
        if (diff != null && diff <= MATCH_CROSS_ANCHOR_MINUTES) score = 1000 + diff;
      }

      if (score == null) continue;
      if (
        !best
        || score < best.score
        || (score === best.score
          && (candidate.at ?? "").localeCompare(best.event.at ?? "") < 0)
      ) {
        best = { event: candidate, score };
      }
    }

    if (best) {
      matches.set(schedule.key, best.event);
      used.add(best.event.key);
    }
  }

  return matches;
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
 * 同一条未来场被手工行与自动行同时记录时合并成一行：
 * 自动行决定标题与身份，手工行补齐日期、时段等自动同步拿不到的信息。
 */
function mergeDuplicateSchedules(schedules: CalendarEventInput[]): CalendarEventInput[] {
  const ordered = [...schedules].sort(
    (a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]
      || a.key.localeCompare(b.key),
  );
  const merged: CalendarEventInput[] = [];
  const index = new Map<string, number>();

  for (const event of ordered) {
    const videoId = scheduleVideoId(event);
    if (!videoId) {
      merged.push({ ...event });
      continue;
    }
    const identity = `${event.datasetId}:${videoId}`;
    const position = index.get(identity);
    if (position === undefined) {
      index.set(identity, merged.length);
      merged.push({ ...event });
      continue;
    }
    const base = merged[position] as CalendarEventInput;
    merged[position] = {
      ...base,
      at: base.at ?? event.at,
      date: base.date ?? event.date,
      slot: base.slot ?? event.slot,
      timeTentative: base.at ? base.timeTentative : event.timeTentative,
      kind: base.kind ?? event.kind,
      hasStream: base.hasStream || event.hasStream,
      expectedMinutes: base.expectedMinutes ?? event.expectedMinutes,
      lastLiveAt: base.lastLiveAt ?? event.lastLiveAt,
      href: base.href ?? event.href,
      url: base.url ?? event.url,
    };
  }

  return merged;
}

/**
 * 合并已结束场次与未来日程。同一个 video_id 只保留一条：
 * `streams` 优先于自动同步，自动同步优先于手工行。
 * 手工行还会按日期 + 时段匹配真实事件，命中后不再单独显示。
 */
export function buildCalendarEvents(input: BuildCalendarInput): CalendarEvent[] {
  const matches = matchSchedulesToStreams(input.streams, input.schedules);

  const streamKeys = new Set<string>();
  for (const event of input.streams) {
    if (event.videoId) streamKeys.add(`${event.datasetId}:${event.videoId}`);
  }

  const schedules = mergeDuplicateSchedules(
    input.schedules.filter(event => !matches.has(event.key)),
  ).filter(event => {
    const videoId = scheduleVideoId(event);
    return !videoId || !streamKeys.has(`${event.datasetId}:${videoId}`);
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
        memberAvatar: member?.avatar ?? null,
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
