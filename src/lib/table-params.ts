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

export interface TableParams {
  q: string;
  sort: TableSortKey;
  dir: SortDirection;
  vstats: boolean;
}

export const DEFAULT_TABLE_PARAMS: TableParams = {
  q: "",
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

export function parseTableParams(searchParams: URLSearchParams): TableParams {
  const q = searchParams.get("q") ?? "";
  const sort = searchParams.get("sort");
  const dir = searchParams.get("dir");
  const vstats = searchParams.get("vstats");

  return {
    q: q.trim() ? q : "",
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
