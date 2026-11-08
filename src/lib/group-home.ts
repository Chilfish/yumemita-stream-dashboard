import {
  DEFAULT_MEMBER_COLOR,
  jstDateKey,
  sortMembersByLatest,
  type GroupMemberSummary,
  type GroupStreamRow,
} from "@/lib/group";
import { isMemberOnly } from "@/lib/visibility";
import type { GroupDayStat, GroupStreamSummary } from "@/types/group";

/** 「最近更新」列表的固定长度：手机上一屏多看两场，桌面也不过长。 */
export const RECENT_UPDATE_LIMIT = 8;

export interface AttendanceCell {
  date: string;
  streams: number;
  chat: number;
}

export interface AttendanceCalendarCell extends AttendanceCell {
  /** 周列，0 = 窗口内最早的一周。 */
  week: number;
  /** 周一 = 0，周日 = 6。 */
  weekday: number;
}

export interface AttendanceAxisLabel {
  label: string;
  week: number;
}

export interface AttendanceRow {
  id: string;
  label: string;
  color: string;
  /** 按周列优先排列：week 0 周一→周日，week 1…；窗口外为 null。 */
  cells: (AttendanceCalendarCell | null)[];
  totalStreams: number;
  totalChat: number;
}

export interface AttendanceView {
  start: string;
  end: string;
  days: number;
  /** 日历列数；每列一周，周一在上。 */
  weeks: number;
  /** 每 4 周一个日期标签，第一个标签用窗口起点。 */
  axis: AttendanceAxisLabel[];
  /** 单体格子的最大场次，至少为 1，供颜色分档；不把空白天当成 0 值画。 */
  maxStreams: number;
  rows: AttendanceRow[];
  totalStreams: number;
  totalChat: number;
}

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;

function startOfWeek(date: Date): Date {
  const offset = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - offset * DAY_MS);
}

function monthDay(date: Date): string {
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

/**
 * 把窗口补成「周列 × 星期行」的日历：每列一周，周一在上。
 * 窗口外的位置留空，窗口内没有开播的日期也保留格子，避免把「没播」误读成「不存在」。
 */
export function buildAttendance(
  members: GroupMemberSummary[],
  dayStats: GroupDayStat[],
  start: string,
  end: string,
): AttendanceView {
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const endTime = Date.parse(`${end}T00:00:00Z`);
  const valid =
    Number.isFinite(startTime) && Number.isFinite(endTime) && endTime >= startTime;
  const dayCount = valid ? Math.round((endTime - startTime) / DAY_MS) + 1 : 0;
  const calendarStart = valid ? startOfWeek(new Date(startTime)) : null;
  const weeks =
    valid && calendarStart
      ? Math.floor(
          (startOfWeek(new Date(endTime)).getTime() - calendarStart.getTime()) /
            (WEEK_DAYS * DAY_MS),
        ) + 1
      : 0;

  const placements = calendarStart
    ? Array.from({ length: dayCount }, (_, index) => {
        const date = new Date(startTime + index * DAY_MS);
        return {
          date: date.toISOString().slice(0, 10),
          week: Math.floor(
            (date.getTime() - calendarStart.getTime()) / (WEEK_DAYS * DAY_MS),
          ),
          weekday: (date.getUTCDay() + 6) % 7,
        };
      })
    : [];

  const axis: AttendanceAxisLabel[] = [];
  if (valid && calendarStart) {
    axis.push({ label: monthDay(new Date(startTime)), week: 0 });
    for (let week = 4; week < weeks; week += 4) {
      axis.push({
        label: monthDay(new Date(calendarStart.getTime() + week * WEEK_DAYS * DAY_MS)),
        week,
      });
    }
  }

  const byMember = new Map<string, Map<string, GroupDayStat>>();
  for (const stat of dayStats) {
    if (stat.date < start || stat.date > end) continue;
    const bucket = byMember.get(stat.datasetId) ?? new Map<string, GroupDayStat>();
    bucket.set(stat.date, stat);
    byMember.set(stat.datasetId, bucket);
  }

  let maxStreams = 0;
  let totalStreams = 0;
  let totalChat = 0;
  const rows = sortMembersByLatest(members).map(member => {
    const bucket = byMember.get(member.dataset.id);
    const cells = new Array<AttendanceCalendarCell | null>(weeks * WEEK_DAYS).fill(null);
    let memberStreams = 0;
    let memberChat = 0;

    for (const placement of placements) {
      const stat = bucket?.get(placement.date);
      const streams = stat?.streams ?? 0;
      const chat = stat?.chat ?? 0;
      memberStreams += streams;
      memberChat += chat;
      maxStreams = Math.max(maxStreams, streams);
      cells[placement.week * WEEK_DAYS + placement.weekday] = {
        ...placement,
        streams,
        chat,
      };
    }

    totalStreams += memberStreams;
    totalChat += memberChat;
    return {
      id: member.dataset.id,
      label: member.dataset.label,
      color: memberAccentColor(member),
      cells,
      totalStreams: memberStreams,
      totalChat: memberChat,
    };
  });

  return {
    start,
    end,
    days: dayCount,
    weeks,
    axis,
    maxStreams: Math.max(1, maxStreams),
    rows,
    totalStreams,
    totalChat,
  };
}

export interface HeroSplit {
  /** 全组最近一场的成员，hero 的主视觉；一条场次都没有时为 null。 */
  focus: GroupMemberSummary | null;
  /** 其余成员，按最近更新排序；完全没场次的排在最后。 */
  rest: GroupMemberSummary[];
  /** 完全没有场次的成员：hero 里只给一句「还没有场次」，不画空卡片。 */
  idle: GroupMemberSummary[];
}

/** 把成员拆成「主视觉 + 其余」：主视觉只留真正有场次的那一位。 */
export function splitHeroMembers(members: GroupMemberSummary[]): HeroSplit {
  const sorted = sortMembersByLatest(members);
  const focus = sorted.find(member => member.latest !== null) ?? null;
  const rest = focus
    ? sorted.filter(member => member.dataset.id !== focus.dataset.id)
    : sorted;

  return {
    focus,
    rest,
    idle: rest.filter(member => member.latest === null),
  };
}

/** 成员原始强调色：点与条形直接用，不做任何明暗偏移（可读文字色见 `lib/color` 的 `memberAccent`）。 */
export function memberAccentColor(member: GroupMemberSummary): string {
  return member.dataset.color ?? DEFAULT_MEMBER_COLOR;
}

export type MemberMetricKey = "streams" | "duration" | "chat" | "superchats" | "concurrent";
export type MemberMetricFormat = "integer" | "decimal";

export interface MemberMetricOption {
  key: MemberMetricKey;
  label: string;
  unit: string;
  format: MemberMetricFormat;
  /** 可累加指标才给占比；平均同接不参与。 */
  additive: boolean;
  value: (member: GroupMemberSummary) => number | null;
}

const MEMBER_METRIC_MAP: Record<MemberMetricKey, MemberMetricOption> = {
  streams: {
    key: "streams",
    label: "场次",
    unit: "场",
    format: "integer",
    additive: true,
    value: member => member.streamCount,
  },
  duration: {
    key: "duration",
    label: "时长",
    unit: "小时",
    format: "decimal",
    additive: true,
    value: member => member.durationSec / 3600,
  },
  chat: {
    key: "chat",
    label: "弹幕",
    unit: "条",
    format: "integer",
    additive: true,
    value: member => member.chatTotal,
  },
  superchats: {
    key: "superchats",
    label: "SC",
    unit: "笔",
    format: "integer",
    additive: true,
    value: member => member.superchats,
  },
  concurrent: {
    key: "concurrent",
    label: "同接",
    unit: "人",
    format: "decimal",
    additive: false,
    value: member => member.avgConcurrent,
  },
};

export const MEMBER_METRICS: MemberMetricOption[] = Object.values(MEMBER_METRIC_MAP);

export function memberMetric(key: MemberMetricKey): MemberMetricOption {
  return MEMBER_METRIC_MAP[key];
}

export interface MemberStanding {
  id: string;
  label: string;
  color: string;
  value: number | null;
  /** 仅在可累加指标上给出；平均同接为 null。 */
  share: number | null;
}

/** 成员榜：按指标降序；没有数值的成员留在列表末尾，显示「—」而不是 0。 */
export function buildMemberStandings(
  members: GroupMemberSummary[],
  key: MemberMetricKey,
): MemberStanding[] {
  const option = memberMetric(key);
  const values = members.map(member => ({
    id: member.dataset.id,
    label: member.dataset.label,
    color: memberAccentColor(member),
    value: option.value(member),
  }));
  const total = option.additive
    ? values.reduce((sum, item) => sum + (item.value ?? 0), 0)
    : 0;

  return values
    .sort((a, b) => {
      const left = a.value ?? Number.NEGATIVE_INFINITY;
      const right = b.value ?? Number.NEGATIVE_INFINITY;
      return right - left || a.label.localeCompare(b.label);
    })
    .map(item => ({
      ...item,
      share: option.additive && total > 0 && item.value != null ? item.value / total : null,
    }));
}

export interface Readout {
  label: string;
  /** `null` = 这一场还没抓到对应数据，显示「—」而不是 0。 */
  value: number | null;
  unit: string;
}

/** 一条场次的首选读数：有 VSTATS 的场次先给峰值同接，没有就退回弹幕。 */
export function primaryReadout(row: GroupStreamSummary): Readout {
  if (row.maxConcurrent != null) {
    return { label: "峰值同接", unit: "人", value: row.maxConcurrent };
  }
  // 会员限定与未抓取都用「—」；不能把屏蔽后的 0 当成真实弹幕数。
  const masked = row.masked ?? isMemberOnly(row.availability);
  const chat = masked || row.chatTotal <= 0 ? null : row.chatTotal;
  return { label: "弹幕", unit: "条", value: chat };
}

/**
 * 次选读数：与首选互补，避免同一个数字出现两次。
 * 弹幕为 0 的场次多半是 datapack 还没抓，不拿 0 当结论。
 */
export function secondaryReadout(row: GroupStreamSummary): Readout {
  const masked = row.masked ?? isMemberOnly(row.availability);
  if (row.maxConcurrent != null) {
    return { label: "弹幕", unit: "条", value: masked || row.chatTotal <= 0 ? null : row.chatTotal };
  }
  return { label: "SC", unit: "笔", value: masked ? null : row.superchats };
}

export interface WeekActivityEntry {
  id: string;
  label: string;
  color: string;
  streams: number;
  /** 占全组近 7 天场次的比例，0–1。 */
  share: number;
}

export interface WeekActivity {
  total: number;
  /** 全部成员，近 7 天场次多的在前；0 场也保留，图例里不静默消失。 */
  entries: WeekActivityEntry[];
  /** 只含有场次的成员，供堆叠条按占比分配宽度。 */
  segments: WeekActivityEntry[];
}

/** 「本周活跃」：只读 `weekStreams`，不重新按日期过滤，口径与 `GroupMemberSummary` 一致。 */
export function buildWeekActivity(members: GroupMemberSummary[]): WeekActivity {
  const total = members.reduce((sum, member) => sum + member.weekStreams, 0);
  const entries = [...members]
    .sort((a, b) => b.weekStreams - a.weekStreams)
    .map(member => ({
      id: member.dataset.id,
      label: member.dataset.label,
      color: memberAccentColor(member),
      streams: member.weekStreams,
      share: total > 0 ? member.weekStreams / total : 0,
    }));

  return {
    total,
    entries,
    segments: entries.filter(entry => entry.streams > 0),
  };
}

/** 「最近更新」：`rows` 已经按开播时间倒序，这里只截断，不再重排。 */
export function recentUpdates(
  rows: GroupStreamRow[],
  limit: number = RECENT_UPDATE_LIMIT,
): GroupStreamRow[] {
  if (limit <= 0) return [];
  return rows.slice(0, limit);
}

export interface TrendPoint {
  videoId: string;
  memberLabel: string;
  startedAt: string | null;
  /** 每分钟弹幕；只含有公开弹幕且有时长的场次。 */
  value: number;
}

/**
 * 跨成员趋势统一用「每分钟弹幕」，避免长场次天然占优。
 * 会员限定与非公开弹幕不进入曲线；返回顺序为旧 → 新，直接喂给 Sparkline。
 */
export function buildRecentTrend(
  rows: GroupStreamRow[],
  limit: number = RECENT_UPDATE_LIMIT,
): TrendPoint[] {
  if (limit <= 0) return [];
  const points: TrendPoint[] = [];
  for (const row of rows) {
    if (points.length >= limit) break;
    if (isMemberOnly(row.availability) || row.chatTotal <= 0 || !row.durationSec) continue;
    points.push({
      videoId: row.videoId,
      memberLabel: row.memberLabel,
      startedAt: row.startedAt,
      value: row.chatTotal / (row.durationSec / 60),
    });
  }
  return points.reverse();
}

function dayDiff(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

/**
 * 相对今天的日差，按 JST 自然日算：今天 / 昨天 / 3 天前 / 2 周前。
 * 一年以上不给相对说法，交给绝对日期。
 */
export function relativeDayLabel(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const started = new Date(iso);
  if (Number.isNaN(started.getTime())) return null;

  const days = dayDiff(jstDateKey(started), jstDateKey(now));
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  if (days < 30) return `${Math.floor(days / 7)} 周前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return null;
}
