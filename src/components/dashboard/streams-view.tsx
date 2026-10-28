import { RotateCcw } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { DataTable, type DataColumn } from "@/components/dashboard/data-table";
import { PageHeader, type Fact } from "@/components/dashboard/page-header";
import { StreamsToolbar } from "@/components/dashboard/streams-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CONTENT_TYPE_LABELS, classifyTitle } from "@/lib/classify";
import {
  formatDate,
  formatDuration,
  formatDurationLong,
  formatInteger,
  formatPercent,
  formatTime,
} from "@/lib/format";
import { streamPath } from "@/lib/routes";
import {
  DEFAULT_TABLE_PARAMS,
  type TableParams,
  type TableSortKey,
  isTableSortKey,
} from "@/lib/table-params";
import type { StreamSummary } from "@/types/dataset";
import { cn } from "@/lib/utils";

export interface StreamsViewProps {
  rows: StreamSummary[];
  /** 用于把行渲染成真实链接（`streamPath`），保留中键 / 新标签打开。 */
  datasetId: string;
  params: TableParams;
  onParamsChange: (next: TableParams) => void;
}

function sortValue(row: StreamSummary, key: TableSortKey): number | null {
  switch (key) {
    case "date":
      return row.startedAt ? Date.parse(row.startedAt) : null;
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

function escapeCsv(value: string | number | null | undefined): string {
  if (value == null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function Missing() {
  return <span className="text-ink-3">—</span>;
}

function numberCell(value: number | null | undefined): ReactNode {
  return value == null ? <Missing /> : formatInteger(value);
}

/** `likesPer1000Views` 是千次播放点赞数，换算成百分比。 */
function likeRateCell(value: number | null | undefined): ReactNode {
  return value == null ? <Missing /> : formatPercent(value / 10, 2);
}

function averageDuration(rows: StreamSummary[]): number | null {
  let total = 0;
  let count = 0;
  for (const row of rows) {
    if (row.durationSec == null) continue;
    total += row.durationSec;
    count += 1;
  }
  return count === 0 ? null : Math.round(total / count);
}

export function StreamsView({ rows, datasetId, params, onParamsChange }: StreamsViewProps) {
  const { q, type: typeFilter, sort, dir, vstats: onlyVstats } = params;

  const facts = useMemo<Fact[]>(() => {
    const chatTotal = rows.reduce((sum, row) => sum + row.chatTotal, 0);
    const withConcurrent = rows.filter(row => row.avgConcurrent != null).length;
    return [
      { value: formatInteger(rows.length), label: "总场次" },
      { value: formatInteger(withConcurrent), label: "有同接场次" },
      { value: formatDurationLong(averageDuration(rows)), label: "平均时长" },
      { value: formatInteger(chatTotal), label: "总弹幕" },
    ];
  }, [rows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = rows.filter(row => {
      if (onlyVstats && row.avgConcurrent == null) return false;
      if (typeFilter !== DEFAULT_TABLE_PARAMS.type && classifyTitle(row.title).key !== typeFilter) {
        return false;
      }
      if (!needle) return true;
      return `${row.title} ${row.date} ${row.videoId}`.toLowerCase().includes(needle);
    });

    return [...filtered].sort((a, b) => {
      const left = sortValue(a, sort);
      const right = sortValue(b, sort);
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      return dir === "asc" ? left - right : right - left;
    });
  }, [rows, q, typeFilter, onlyVstats, sort, dir]);

  const columns: DataColumn<StreamSummary>[] = useMemo(
    () => [
      {
        key: "date",
        header: "日期",
        sortable: true,
        width: "7.25rem",
        render: row => (
          <span className="flex items-baseline gap-1.5">
            <span className="tabular-nums">{formatDate(row.startedAt)}</span>
            <span className="text-caption text-ink-3 tabular-nums">
              {formatTime(row.startedAt)}
            </span>
          </span>
        ),
      },
      {
        key: "stream",
        header: "场次",
        headerClassName: "w-full",
        render: row => (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="max-w-[38ch] truncate font-medium text-foreground">{row.title}</span>
            {row.availability === "subscriber_only" ? (
              <Badge className="shrink-0" size="sm" variant="outline">
                会员
              </Badge>
            ) : null}
          </span>
        ),
      },
      {
        key: "type",
        header: "类型",
        width: "4.25rem",
        render: row => (
          <span className="text-muted-foreground">
            {CONTENT_TYPE_LABELS[classifyTitle(row.title).key]}
          </span>
        ),
      },
      {
        key: "duration",
        header: "时长",
        align: "right",
        sortable: true,
        width: "5.5rem",
        render: row =>
          row.durationSec == null ? <Missing /> : <span>{formatDuration(row.durationSec)}</span>,
      },
      {
        key: "avg",
        header: "平均同接",
        align: "right",
        sortable: true,
        width: "6rem",
        render: row => numberCell(row.avgConcurrent),
      },
      {
        key: "max",
        header: "峰值",
        align: "right",
        sortable: true,
        width: "5rem",
        render: row => numberCell(row.maxConcurrent),
      },
      {
        key: "views",
        header: "播放",
        align: "right",
        sortable: true,
        width: "5.5rem",
        render: row => numberCell(row.vstatsViews ?? row.snapshotViews),
      },
      {
        key: "chat",
        header: "弹幕",
        align: "right",
        sortable: true,
        width: "5.5rem",
        render: row => numberCell(row.chatTotal),
      },
      {
        key: "authors",
        header: "人数",
        align: "right",
        sortable: true,
        width: "5rem",
        render: row => numberCell(row.uniqueAuthors),
      },
      {
        key: "sc",
        header: "SC",
        align: "right",
        sortable: true,
        width: "3.5rem",
        render: row => numberCell(row.superchats),
      },
      {
        key: "comments",
        header: "评论",
        align: "right",
        sortable: true,
        width: "4.5rem",
        render: row => numberCell(row.commentsCaptured),
      },
      {
        key: "likeRate",
        header: "点赞率",
        align: "right",
        width: "4.5rem",
        render: row => likeRateCell(row.likesPer1000Views),
      },
    ],
    [],
  );

  function handleSort(key: string): void {
    if (!isTableSortKey(key)) return;
    if (key === sort) {
      onParamsChange({ ...params, dir: dir === "asc" ? "desc" : "asc" });
      return;
    }
    onParamsChange({ ...params, sort: key, dir: "desc" });
  }

  function resetFilters(): void {
    onParamsChange({ ...DEFAULT_TABLE_PARAMS });
  }

  function exportCsv(): void {
    const headers = [
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
    const body = visible.map(row => [
      row.date,
      row.title,
      CONTENT_TYPE_LABELS[classifyTitle(row.title).key],
      row.videoId,
      row.durationHms,
      row.avgConcurrent,
      row.maxConcurrent,
      row.watchTimeHours,
      row.vstatsViews ?? row.snapshotViews,
      row.vstatsLikes ?? row.snapshotLikes,
      row.chatTotal,
      row.uniqueAuthors,
      row.superchats,
      row.commentsCaptured,
    ]);
    const csv = [headers, ...body].map(line => line.map(escapeCsv).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${datasetId}-streams.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-3">
      <PageHeader facts={facts} title="场次" />

      <section aria-label="场次列表" className="flex flex-col gap-2">
        <StreamsToolbar onExport={exportCsv} onParamsChange={onParamsChange} params={params} />

        {visible.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-panel bg-card px-4 py-8 shadow-surface">
            <p className="text-body text-muted-foreground">
              没有匹配的场次：当前搜索与筛选条件排除了全部 {rows.length} 场。
            </p>
            <Button onClick={resetFilters} size="sm" type="button" variant="outline">
              <RotateCcw aria-hidden="true" />
              清除筛选
            </Button>
          </div>
        ) : (
          <div
            className={cn(
              "rounded-panel bg-card shadow-surface",
              // coss Table 把 <table> 包在 overflow-x-auto 的容器里且没有高度上限，
              // 直接 sticky 无效。这里把该容器变成有界滚动视口（桌面），
              // 并把吸顶偏移从 top-14 归零，让表头真正贴住滚动区域顶部。
              "lg:[&>[data-slot=table-container]]:max-h-[calc(100dvh-13rem)] lg:[&>[data-slot=table-container]]:overflow-auto",
              "[&>[data-slot=table-container]]:rounded-panel",
              "[&_thead_th]:top-0 [&_thead_th]:h-8 [&_thead_th]:border-b [&_thead_th]:border-hairline",
            )}
          >
            <DataTable
              ariaLabel="场次列表"
              columns={columns}
              onSort={handleSort}
              rowHref={row => streamPath(datasetId, row.videoId)}
              rowKey={row => row.videoId}
              rowLabel={row => `打开 ${row.title}`}
              rows={visible}
              sort={{ key: sort, dir }}
              stickyHeader
            />
          </div>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-caption text-ink-3">
          <p className="tabular-nums">
            共 {formatInteger(rows.length)} 场 · 筛选后 {formatInteger(visible.length)} 场
          </p>
          <p>排序与筛选会写进 URL</p>
        </footer>
      </section>
    </div>
  );
}
