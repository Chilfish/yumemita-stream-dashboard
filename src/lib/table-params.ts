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

/**
 * 默认不显示的指标列。日期、场次、时长、峰值、播放、弹幕始终可见，
 * 其余列按需打开，避免首屏一次铺满十二列。
 */
export const OPTIONAL_TABLE_COLUMNS = [
  "type",
  "avg",
  "authors",
  "sc",
  "comments",
  "likeRate",
] as const;

export type OptionalTableColumn = (typeof OPTIONAL_TABLE_COLUMNS)[number];

export interface TableParams {
  q: string;
  type: StreamTypeFilter;
  sort: TableSortKey;
  dir: SortDirection;
  vstats: boolean;
  member: boolean;
  cols: OptionalTableColumn[];
}

export const DEFAULT_TABLE_PARAMS: TableParams = {
  q: "",
  type: DEFAULT_STREAM_TYPE_FILTER,
  sort: "date",
  dir: "desc",
  vstats: false,
  member: false,
  cols: [],
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

export function isOptionalTableColumn(value: unknown): value is OptionalTableColumn {
  return (
    typeof value === "string" && (OPTIONAL_TABLE_COLUMNS as readonly string[]).includes(value)
  );
}

/** URL 里只保存非默认列，固定按导出顺序写，避免点击顺序造成无意义的 URL 差异。 */
function normalizeColumns(keys: Iterable<string>): OptionalTableColumn[] {
  const wanted = new Set(keys);
  return OPTIONAL_TABLE_COLUMNS.filter(key => wanted.has(key));
}

export function sameColumnSet(
  a: readonly OptionalTableColumn[],
  b: readonly OptionalTableColumn[],
): boolean {
  return a.length === b.length && a.every(key => b.includes(key));
}

export function parseTableParams(searchParams: URLSearchParams): TableParams {
  const q = searchParams.get("q");
  const type = searchParams.get("type");
  const sort = searchParams.get("sort");
  const dir = searchParams.get("dir");
  const vstats = searchParams.get("vstats");
  const member = searchParams.get("member");
  const cols = searchParams.get("cols");

  return {
    q: q && q.trim() ? q : "",
    type: isStreamTypeFilter(type) ? type : DEFAULT_TABLE_PARAMS.type,
    sort: isTableSortKey(sort) ? sort : DEFAULT_TABLE_PARAMS.sort,
    dir: isSortDirection(dir) ? dir : DEFAULT_TABLE_PARAMS.dir,
    vstats: vstats === "1" || vstats === "true",
    member: member === "1" || member === "true",
    cols: cols ? normalizeColumns(cols.split(",")) : [],
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

  if (params.member) {
    next.set("member", "1");
  } else {
    next.delete("member");
  }

  const cols = normalizeColumns(params.cols);
  if (cols.length > 0) {
    next.set("cols", cols.join(","));
  } else {
    next.delete("cols");
  }

  return next;
}
