import { formatTime } from "@/lib/format";
import type { CalendarEvent, CalendarEventState } from "@/types/calendar";

export const CALENDAR_STATE_LABELS: Record<CalendarEventState, string> = {
  done: "已结束",
  live: "直播中",
  upcoming: "预定",
  cancelled: "已取消",
  pending: "待补录",
  undated: "日期待定",
};

export function eventAriaLabel(event: CalendarEvent): string {
  const parts: string[] = [];
  if (event.at) parts.push(formatTime(event.at));
  parts.push(event.memberLabel, event.title, CALENDAR_STATE_LABELS[event.state]);
  if (event.memberOnly) parts.push("会员限定");
  return parts.join("，");
}
