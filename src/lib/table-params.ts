import { CONTENT_TYPES, isContentType } from "@/lib/classify";

export const TABLE_SORT_KEYS = [
  "date",
  "duration",
  "avg",
  "max",
  "watch",
  "views",
  "likes",
  "chat",
  "authors",
  "sc",
  "comments",
] as const;

export type TableSortKey = (typeof TABLE_SORT_KEYS)[number];

export const TABLE_SORT_DIRECTIONS = ["asc", "desc"] as const;

export type SortDirection = (typeof TABLE_SORT_DIRECTIONS)[number];

/** 内容类型筛选：`all` 表示不筛，其余与 `classify.ts` 的类型键一一对应。 */
export const STREAM_TYPE_FILTERS = ["all", ...CONTENT_TYPES] as const;

export type StreamTypeFilter = (typeof STREAM_TYPE_FILTERS)[number];

export const DEFAULT_STREAM_TYPE_FILTER: StreamTypeFilter = "all";

export interface TableParams {
  q: string;
  type: StreamTypeFilter;
  sort: TableSortKey;
  dir: SortDirection;
  vstats: boolean;
}

export const DEFAULT_TABLE_PARAMS: TableParams = {
  q: "",
  type: DEFAULT_STREAM_TYPE_FILTER,
  sort: "date",
  dir: "desc",
  vstats: false,
};

export function isTableSortKey(value: unknown): value is TableSortKey {
  return typeof value === "string" && (TABLE_SORT_KEYS as readonly string[]).includes(value);
}

export function isSortDirection(value: unknown): value is SortDirection {
  return typeof value === "string" && (TABLE_SORT_DIRECTIONS as readonly string[]).includes(value);
}

export function isStreamTypeFilter(value: unknown): value is StreamTypeFilter {
  return value === DEFAULT_STREAM_TYPE_FILTER || isContentType(value);
}

export function parseTableParams(searchParams: URLSearchParams): TableParams {
  const q = searchParams.get("q");
  const type = searchParams.get("type");
  const sort = searchParams.get("sort");
  const dir = searchParams.get("dir");
  const vstats = searchParams.get("vstats");

  return {
    q: q && q.trim() ? q : "",
    type: isStreamTypeFilter(type) ? type : DEFAULT_TABLE_PARAMS.type,
    sort: isTableSortKey(sort) ? sort : DEFAULT_TABLE_PARAMS.sort,
    dir: isSortDirection(dir) ? dir : DEFAULT_TABLE_PARAMS.dir,
    vstats: vstats === "1" || vstats === "true",
  };
}

export function writeTableParams(
  base: URLSearchParams,
  params: TableParams,
): URLSearchParams {
  const next = new URLSearchParams(base);

  if (params.q.trim()) {
    next.set("q", params.q);
  } else {
    next.delete("q");
  }

  if (params.type === DEFAULT_TABLE_PARAMS.type) {
    next.delete("type");
  } else {
    next.set("type", params.type);
  }

  if (params.sort === DEFAULT_TABLE_PARAMS.sort) {
    next.delete("sort");
  } else {
    next.set("sort", params.sort);
  }

  if (params.dir === DEFAULT_TABLE_PARAMS.dir) {
    next.delete("dir");
  } else {
    next.set("dir", params.dir);
  }

  if (params.vstats) {
    next.set("vstats", "1");
  } else {
    next.delete("vstats");
  }

  return next;
}
