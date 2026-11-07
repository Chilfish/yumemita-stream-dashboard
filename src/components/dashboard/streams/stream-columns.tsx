import type { ReactNode } from "react";
import { type DataColumn } from "@/components/dashboard/primitives/data-table";
import { Badge } from "@/components/ui/badge";
import { CONTENT_TYPE_LABELS, classifyTitle } from "@/lib/classify";
import {
  formatDate,
  formatDuration,
  formatInteger,
  formatPercent,
  formatTime,
} from "@/lib/format";
import type { OptionalTableColumn } from "@/lib/table-params";
import type { StreamSummary } from "@/types/dataset";
import { isMemberOnly } from "@/lib/visibility";

function Missing() {
  return <span className="text-ink-3 opacity-40">—</span>;
}

/** 数字默认退到二级色，只有主指标（峰值）用前景色加粗，给每行一个落点。 */
function numberCell(value: number | null | undefined, strong = false): ReactNode {
  if (value == null) return <Missing />;
  return (
    <span className={strong ? "font-medium text-foreground" : "text-muted-foreground"}>
      {formatInteger(value)}
    </span>
  );
}

/** `likesPer1000Views` 是千次播放点赞数，换算成百分比。 */
function likeRateCell(value: number | null | undefined): ReactNode {
  if (value == null) return <Missing />;
  return <span className="text-muted-foreground">{formatPercent(value / 10, 2)}</span>;
}

function streamMetricCell(
  row: StreamSummary,
  value: number | null | undefined,
  strong = false,
): ReactNode {
  if (isMemberOnly(row.availability)) return <Missing />;
  return numberCell(value, strong);
}

function streamRateCell(row: StreamSummary, value: number | null | undefined): ReactNode {
  if (isMemberOnly(row.availability)) return <Missing />;
  return likeRateCell(value);
}

/** 默认只铺六列；其余指标按 URL 里的 cols 追加，避免首屏十二列同时抢注意力。 */
export function buildStreamColumns(extraCols: Set<OptionalTableColumn>): DataColumn<StreamSummary>[] {
  return [
    {
      key: "date",
      header: "日期",
      sortable: true,
      width: "7.25rem",
      render: row => (
        <span className="flex items-baseline gap-1.5 text-muted-foreground">
          <span className="tabular-nums">{formatDate(row.startedAt)}</span>
          <span className="text-caption text-ink-3 tabular-nums">{formatTime(row.startedAt)}</span>
        </span>
      ),
    },
    {
      key: "stream",
      header: "场次",
      headerClassName: "w-full",
      cellClassName: "whitespace-normal py-2 leading-snug",
      render: row => (
        <>
          <span className="break-words font-medium text-foreground">{row.title}</span>
          {row.availability === "subscriber_only" ? (
            <Badge className="ms-1.5 align-middle" size="sm" variant="outline">
              会员
            </Badge>
          ) : null}
        </>
      ),
    },
    ...(extraCols.has("type")
      ? [
          {
            key: "type",
            header: "类型",
            width: "4.25rem",
            render: (row: StreamSummary) => (
              <span className="text-ink-3">{CONTENT_TYPE_LABELS[classifyTitle(row.title).key]}</span>
            ),
          } satisfies DataColumn<StreamSummary>,
        ]
      : []),
    {
      key: "duration",
      header: "时长",
      align: "right",
      sortable: true,
      width: "5.5rem",
      render: row =>
        row.durationSec == null ? (
          <Missing />
        ) : (
          <span className="text-muted-foreground">{formatDuration(row.durationSec)}</span>
        ),
    },
    ...(extraCols.has("avg")
      ? [
          {
            key: "avg",
            header: "平均同接",
            align: "right" as const,
            sortable: true,
            width: "6rem",
            render: (row: StreamSummary) => streamMetricCell(row, row.avgConcurrent),
          } satisfies DataColumn<StreamSummary>,
        ]
      : []),
    {
      key: "max",
      header: "峰值",
      align: "right",
      sortable: true,
      width: "5rem",
      render: row => streamMetricCell(row, row.maxConcurrent, true),
    },
    {
      key: "views",
      header: "播放",
      align: "right",
      sortable: true,
      width: "5.5rem",
      render: row => streamMetricCell(row, row.vstatsViews ?? row.snapshotViews),
    },
    {
      key: "chat",
      header: "弹幕",
      align: "right",
      sortable: true,
      width: "5.5rem",
      render: row => streamMetricCell(row, row.chatTotal),
    },
    ...(extraCols.has("authors")
      ? [
          {
            key: "authors",
            header: "人数",
            align: "right" as const,
            sortable: true,
            width: "5rem",
            render: (row: StreamSummary) => streamMetricCell(row, row.uniqueAuthors),
          } satisfies DataColumn<StreamSummary>,
        ]
      : []),
    ...(extraCols.has("sc")
      ? [
          {
            key: "sc",
            header: "SC",
            align: "right" as const,
            sortable: true,
            width: "3.5rem",
            render: (row: StreamSummary) => streamMetricCell(row, row.superchats),
          } satisfies DataColumn<StreamSummary>,
        ]
      : []),
    ...(extraCols.has("comments")
      ? [
          {
            key: "comments",
            header: "评论",
            align: "right" as const,
            sortable: true,
            width: "4.5rem",
            render: (row: StreamSummary) => streamMetricCell(row, row.commentsCaptured),
          } satisfies DataColumn<StreamSummary>,
        ]
      : []),
    ...(extraCols.has("likeRate")
      ? [
          {
            key: "likeRate",
            header: "点赞率",
            align: "right" as const,
            width: "4.5rem",
            render: (row: StreamSummary) => streamRateCell(row, row.likesPer1000Views),
          } satisfies DataColumn<StreamSummary>,
        ]
      : []),
  ];
}
