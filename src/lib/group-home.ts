import {
  DEFAULT_MEMBER_COLOR,
  jstDateKey,
  sortMembersByLatest,
  type GroupMemberSummary,
  type GroupStreamRow,
} from "@/lib/group";
import type { GroupStreamSummary } from "@/types/group";

/** 「最近更新」列表的固定长度：手机上一屏多看两场，桌面也不过长。 */
export const RECENT_UPDATE_LIMIT = 8;

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
  return { label: "弹幕", unit: "条", value: row.chatTotal > 0 ? row.chatTotal : null };
}

/**
 * 次选读数：与首选互补，避免同一个数字出现两次。
 * 弹幕为 0 的场次多半是 datapack 还没抓，不拿 0 当结论。
 */
export function secondaryReadout(row: GroupStreamSummary): Readout {
  if (row.maxConcurrent != null) {
    return { label: "弹幕", unit: "条", value: row.chatTotal > 0 ? row.chatTotal : null };
  }
  return { label: "SC", unit: "笔", value: row.superchats };
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
