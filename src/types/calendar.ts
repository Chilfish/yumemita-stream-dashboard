/**
 * 直播日历的 DTO。读取时把 `streams`（已结束）与 `scheduled_streams`（未来）
 * 合并成同一种事件；状态由 `now` 派生，不落库。
 */

export type CalendarEventState =
  | "done"
  | "live"
  | "upcoming"
  | "cancelled"
  | "pending"
  | "undated";

import type { ContentTypeKey } from "@/lib/classify";

export type CalendarSource = "stream" | "youtube" | "manual";

/** 大时段。`late` 覆盖 18:00–次日 04:59。 */
export type ScheduleSlot = "early" | "mid" | "late";

export type CalendarViewMode = "month" | "agenda";

export interface CalendarEventInput {
  /** `stream:<videoId>` 或 `schedule:<datasetId>:<eventKey>`；跨成员不重复。 */
  key: string;
  datasetId: string;
  videoId: string | null;
  title: string;
  /** ISO 8601；日期待定时为 null。只有日期+时段时是名义时间。 */
  at: string | null;
  /** JST 自然日。 */
  date: string | null;
  slot: ScheduleSlot | null;
  /** 内容类型；标题为空且未指定时为 null。 */
  kind: ContentTypeKey | null;
  /** true = 只有日期+时段，`at` 只是名义时间，不展示具体时刻。 */
  timeTentative: boolean;
  endAt: string | null;
  expectedMinutes: number | null;
  cancelled: boolean;
  /** 服务端判定：同一个 video_id 已经出现在 `streams` 里。 */
  hasStream: boolean;
  /** 最近一次频道检查报告 `is_live` 的时刻。 */
  lastLiveAt: string | null;
  memberOnly: boolean;
  source: CalendarSource;
  /** 站内单场地址；只有已结束的场次才有。 */
  href: string | null;
  /** YouTube 链接，用于未来场的外链动作。 */
  url: string | null;
}

export interface CalendarEvent extends CalendarEventInput {
  state: CalendarEventState;
  memberLabel: string;
  color: string;
  /** 成员头像 key（`avatars/...`）；分享卡片使用。 */
  memberAvatar: string | null;
}

export interface CalendarMember {
  id: string;
  label: string;
  color: string | null;
  avatar: string | null;
  streamCount: number;
}

/** 预取窗口，按 `YYYY-MM` 闭区间表示。 */
export interface CalendarWindow {
  start: string;
  end: string;
}

export interface CalendarPageData {
  members: CalendarMember[];
  events: CalendarEvent[];
  /** SSR 时刻，客户端水合后可以换成当前时间重算状态。 */
  now: string;
  window: CalendarWindow;
}

export interface DayPlanDay {
  /** JST 自然日。 */
  date: string;
  /** 0 = 今天，1 = 明天。 */
  offset: number;
  events: CalendarEvent[];
}

/** 今天 + 明天的安排；跨天朝活也能看到。 */
export interface DayPlan {
  /** SSR 时刻，客户端水合后重新派生状态。 */
  now: string;
  days: DayPlanDay[];
  /** 全组成员，分享卡片底部展示头像。 */
  members: CalendarMember[];
}

export interface AdminScheduleItem {
  datasetId: string;
  eventKey: string;
  videoId: string | null;
  title: string;
  url: string | null;
  date: string | null;
  slot: ScheduleSlot | null;
  kind: ContentTypeKey | null;
  scheduledAt: string | null;
  timeTentative: boolean;
  expectedMinutes: number | null;
  availability: string | null;
  cancelled: boolean;
  note: string | null;
  source: CalendarSource;
  state: CalendarEventState;
  /** 读取时按日期 + 时段匹配到的真实场次。 */
  matchedStream: { videoId: string; title: string; href: string } | null;
  updatedAt: string | null;
}

export interface CalendarParams {
  /** `YYYY-MM`；缺省时由页面用当前 JST 月份填充。 */
  month: string;
  /** `YYYY-MM-DD`；只表示当前展开的那一天。 */
  day: string | null;
  /** 空数组等于全部成员。 */
  members: string[];
  /** null = 按断点选择：桌面月视图、移动议程。 */
  view: CalendarViewMode | null;
}
