import { CONTENT_TYPE_LABELS, classifyTitle } from "@/lib/classify";
import {
  DEFAULT_TABLE_PARAMS,
  type TableParams,
  type TableSortKey,
} from "@/lib/table-params";
import type { StreamSummary } from "@/types/dataset";
import { isMemberOnly } from "@/lib/visibility";

/** 场次表的一行筛选条件；与 `TableParams` 的键保持一致。 */
export interface StreamFilter {
  q: string;
  type: string;
  onlyVstats: boolean;
  onlyMember: boolean;
}

/** 会限只公开场次与日期；指标排序时把这一行推到最后。 */
export function sortValue(
  row: StreamSummary,
  key: TableSortKey,
  dateMs: number | null,
): number | null {
  if (isMemberOnly(row.availability) && key !== "date" && key !== "duration") return null;

  switch (key) {
    case "date":
      return dateMs;
    case "duration":
      return row.durationSec;
    case "avg":
      return row.avgConcurrent;
    case "max":
      return row.maxConcurrent;
    case "watch":
      return row.watchTimeHours;
    case "views":
      return row.vstatsViews ?? row.snapshotViews;
    case "likes":
      return row.vstatsLikes ?? row.snapshotLikes;
    case "chat":
      return row.chatTotal;
    case "authors":
      return row.uniqueAuthors;
    case "sc":
      return row.superchats;
    case "comments":
      return row.commentsCaptured;
    default:
      return null;
  }
}

/** 日期排序只解析一次：比较器里每次 Date.parse 会让 500 场排序变成上万次解析。 */
export function buildStartTimes(rows: StreamSummary[]): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const row of rows) {
    map.set(row.videoId, row.startedAt ? Date.parse(row.startedAt) : null);
  }
  return map;
}

export function filterStreams(
  rows: StreamSummary[],
  filter: StreamFilter,
  sort: TableSortKey,
  dir: "asc" | "desc",
  startTimes: Map<string, number | null>,
): StreamSummary[] {
  const needle = filter.q.trim().toLowerCase();
  const filtered = rows.filter(row => {
    if (filter.onlyVstats && row.avgConcurrent == null) return false;
    if (filter.onlyMember && row.availability !== "subscriber_only") return false;
    if (
      filter.type !== DEFAULT_TABLE_PARAMS.type &&
      classifyTitle(row.title).key !== filter.type
    ) {
      return false;
    }
    if (!needle) return true;
    return `${row.title} ${row.date} ${row.videoId}`.toLowerCase().includes(needle);
  });

  return [...filtered].sort((a, b) => {
    const left = sortValue(a, sort, startTimes.get(a.videoId) ?? null);
    const right = sortValue(b, sort, startTimes.get(b.videoId) ?? null);
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    return dir === "asc" ? left - right : right - left;
  });
}

export function averageDuration(rows: StreamSummary[]): number | null {
  let total = 0;
  let count = 0;
  for (const row of rows) {
    if (row.durationSec == null) continue;
    total += row.durationSec;
    count += 1;
  }
  return count === 0 ? null : Math.round(total / count);
}

export function filterKeyOf(params: TableParams): string {
  return `${params.q}|${params.type}|${params.sort}|${params.dir}|${params.vstats}|${params.member}`;
}

function escapeCsv(value: string | number | null | undefined): string {
  if (value == null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const CSV_HEADERS = [
  "日期",
  "标题",
  "类型",
  "videoId",
  "时长",
  "平均同接",
  "最大同接",
  "视聴时间(人时)",
  "播放",
  "点赞",
  "弹幕",
  "发言人数",
  "SC",
  "评论",
];

/** 会限只导出元数据，指标留空，避免 CSV 绕过详情页的公开范围。 */
export function buildStreamsCsv(rows: StreamSummary[]): string {
  const body = rows.map(row => {
    const memberOnly = isMemberOnly(row.availability);
    return [
      row.date,
      row.title,
      CONTENT_TYPE_LABELS[classifyTitle(row.title).key],
      row.videoId,
      row.durationHms,
      memberOnly ? null : row.avgConcurrent,
      memberOnly ? null : row.maxConcurrent,
      memberOnly ? null : row.watchTimeHours,
      memberOnly ? null : (row.vstatsViews ?? row.snapshotViews),
      memberOnly ? null : (row.vstatsLikes ?? row.snapshotLikes),
      memberOnly ? null : row.chatTotal,
      memberOnly ? null : row.uniqueAuthors,
      memberOnly ? null : row.superchats,
      memberOnly ? null : row.commentsCaptured,
    ];
  });
  return [CSV_HEADERS, ...body].map(line => line.map(escapeCsv).join(",")).join("\n");
}

export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
