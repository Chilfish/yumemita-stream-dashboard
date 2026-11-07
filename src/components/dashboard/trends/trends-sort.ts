import type { ContentTypeStat, MonthlyPoint } from "@/lib/aggregate";

export type MonthSortKey =
  | "month"
  | "streams"
  | "duration"
  | "chat"
  | "rate"
  | "sc"
  | "authors"
  | "avg";
export type TypeSortKey = "streams" | "duration" | "rate" | "scPerHour" | "comments" | "avg";

const MONTH_SORT_KEYS: MonthSortKey[] = [
  "month",
  "streams",
  "duration",
  "chat",
  "rate",
  "sc",
  "authors",
  "avg",
];
const TYPE_SORT_KEYS: TypeSortKey[] = [
  "streams",
  "duration",
  "rate",
  "scPerHour",
  "comments",
  "avg",
];

export interface SortState<K extends string> {
  key: K;
  dir: "asc" | "desc";
}

export interface BestValue {
  value: number | null;
  count: number;
}

export function isMonthSortKey(value: string): value is MonthSortKey {
  return MONTH_SORT_KEYS.includes(value as MonthSortKey);
}

export function isTypeSortKey(value: string): value is TypeSortKey {
  return TYPE_SORT_KEYS.includes(value as TypeSortKey);
}

export function toggleSort<K extends string>(current: SortState<K>, key: K): SortState<K> {
  if (current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: "desc" };
}

export function monthSortValue(point: MonthlyPoint, key: MonthSortKey): number | null {
  switch (key) {
    case "month":
      return Number(point.month.replace("-", ""));
    case "streams":
      return point.streams;
    case "duration":
      return point.durationSec;
    case "chat":
      return point.chatTotal;
    case "rate":
      return point.chatPerMinute;
    case "sc":
      return point.superchats;
    case "authors":
      return point.avgAuthors;
    case "avg":
      return point.avgConcurrent;
  }
}

export function typeSortValue(stat: ContentTypeStat, key: TypeSortKey): number | null {
  switch (key) {
    case "streams":
      return stat.streams;
    case "duration":
      return stat.avgDurationSec;
    case "rate":
      return stat.chatPerMinute;
    case "scPerHour":
      return stat.scPerHour;
    case "comments":
      return stat.commentsPerStream;
    case "avg":
      return stat.avgConcurrent;
  }
}

/** 空值永远排在最后，不随升降序翻转。 */
export function sortBy<T>(
  rows: T[],
  dir: SortState<string>["dir"],
  value: (row: T) => number | null,
): T[] {
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    return dir === "asc" ? left - right : right - left;
  });
}

export function bestOf(values: (number | null)[]): BestValue {
  const numeric = values.filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  return {
    value: numeric.length > 0 ? Math.max(...numeric) : null,
    count: numeric.length,
  };
}

export function isBest(value: number | null, best: BestValue): boolean {
  return value != null && best.value != null && best.count > 1 && value === best.value;
}
