import { formatTime } from "@/lib/format";
import { SLOT_LABELS } from "@/lib/schedule";
import type { CalendarEvent, CalendarEventState } from "@/types/calendar";

export const CALENDAR_STATE_LABELS: Record<CalendarEventState, string> = {
  done: "已结束",
  live: "直播中",
  upcoming: "预定",
  cancelled: "已取消",
  pending: "待补录",
  undated: "日期待定",
};

/** 有时间显示时刻；只有日期+时段时显示「早上 / 中午 / 晚上」。 */
export function eventTimeLabel(event: Pick<CalendarEvent, "at" | "slot" | "timeTentative">): string {
  if (event.timeTentative && event.slot) return SLOT_LABELS[event.slot];
  return formatTime(event.at);
}

export const UNTITLED_LABEL = "待定";

export function eventTitle(event: Pick<CalendarEvent, "title">): string {
  return event.title.trim() || UNTITLED_LABEL;
}

export function eventAriaLabel(event: CalendarEvent): string {
  const parts: string[] = [];
  if (event.at) parts.push(eventTimeLabel(event));
  parts.push(event.memberLabel, eventTitle(event), CALENDAR_STATE_LABELS[event.state]);
  if (event.memberOnly) parts.push("会员限定");
  return parts.join("，");
}
