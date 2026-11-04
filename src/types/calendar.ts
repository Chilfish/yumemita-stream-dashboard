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

export type CalendarSource = "stream" | "youtube" | "manual";

export type CalendarViewMode = "month" | "agenda";

export interface CalendarEventInput {
  /** `stream:<videoId>` 或 `schedule:<eventKey>`。 */
  key: string;
  datasetId: string;
  videoId: string | null;
  title: string;
  /** ISO 8601；日期待定时为 null。 */
  at: string | null;
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
