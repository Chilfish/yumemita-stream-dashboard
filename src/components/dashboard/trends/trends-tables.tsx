import type { ReactNode } from "react";
import { DataTable, type DataColumn } from "@/components/dashboard/primitives/data-table";
import { Delta } from "@/components/dashboard/primitives/delta";
import { type ContentTypeStat, type MonthlyPoint, percentChange } from "@/lib/aggregate";
import {
  formatDecimal,
  formatDurationLong,
  formatInteger,
  formatPercent,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { type TrendMetric, metricValue } from "./trends-metrics";
import {
  type BestValue,
  type MonthSortKey,
  type SortState,
  type TypeSortKey,
  bestOf,
  isBest,
} from "./trends-sort";

function accent(value: string, highlighted: boolean): ReactNode {
  return (
    <span className={cn(highlighted && "font-semibold text-foreground")}>{value}</span>
  );
}

export interface MonthTableProps {
  rows: MonthlyPoint[];
  series: MonthlyPoint[];
  metric: TrendMetric;
  metricLabel: string;
  monthSort: SortState<MonthSortKey>;
  onSort: (key: string) => void;
  summary: Record<string, ReactNode>;
}

export function MonthTable({
  rows,
  series,
  metric,
  metricLabel,
  monthSort,
  onSort,
  summary,
}: MonthTableProps) {
  const deltaByMonth = new Map<string, { value: number | null; label: string }>();
  series.forEach((point, index) => {
    const previous = index > 0 ? series[index - 1] : undefined;
    deltaByMonth.set(point.month, {
      value: percentChange(
        metricValue(point, metric),
        previous ? metricValue(previous, metric) : null,
      ),
      label: previous ? `vs ${previous.label}` : "无上月",
    });
  });

  const columns: DataColumn<MonthlyPoint>[] = [
    {
      key: "month",
      header: "月份",
      width: "6rem",
      sortable: true,
      render: point => <span className="tabular-nums">{point.month}</span>,
    },
    {
      key: "delta",
      header: `${metricLabel} 环比`,
      align: "right",
      width: "8rem",
      render: point => {
        const delta = deltaByMonth.get(point.month);
        return (
          <Delta compareLabel={delta?.label ?? "无上月"} value={delta?.value ?? null} />
        );
      },
    },
    {
      key: "streams",
      header: "场次",
      align: "right",
      width: "4rem",
      sortable: true,
      render: point => formatInteger(point.streams),
    },
    {
      key: "duration",
      header: "总时长",
      align: "right",
      width: "6rem",
      sortable: true,
      render: point =>
        point.durationSec > 0 ? formatDurationLong(point.durationSec) : "—",
    },
    {
      key: "chat",
      header: "弹幕",
      align: "right",
      width: "6rem",
      sortable: true,
      render: point => formatInteger(point.chatTotal),
    },
    {
      key: "rate",
      header: "弹幕/分",
      align: "right",
      width: "5.5rem",
      sortable: true,
      render: point => formatDecimal(point.chatPerMinute),
    },
    {
      key: "sc",
      header: "SC",
      align: "right",
      width: "3.5rem",
      sortable: true,
      render: point => formatInteger(point.superchats),
    },
    {
      key: "authors",
      header: "平均发言",
      align: "right",
      width: "5.5rem",
      sortable: true,
      render: point => formatInteger(point.avgAuthors),
    },
    {
      key: "avg",
      header: "平均同接",
      align: "right",
      width: "5.5rem",
      sortable: true,
      render: point => formatInteger(point.avgConcurrent),
    },
  ];

  return (
    <DataTable
      ariaLabel="月度明细"
      className="min-w-[46rem]"
      columns={columns}
      empty="没有可用的月度数据"
      onSort={onSort}
      rowKey={point => point.month}
      rows={rows}
      sort={monthSort}
      stickyFirstColumn
      summary={summary}
    />
  );
}

export interface TypeTableProps {
  rows: ContentTypeStat[];
  all: ContentTypeStat[];
  typeSort: SortState<TypeSortKey>;
  onSort: (key: string) => void;
}

export function TypeTable({ rows, all, typeSort, onSort }: TypeTableProps) {
  const bests: Record<TypeSortKey, BestValue> = {
    streams: bestOf(all.map(stat => stat.streams)),
    duration: bestOf(all.map(stat => stat.avgDurationSec)),
    rate: bestOf(all.map(stat => stat.chatPerMinute)),
    scPerHour: bestOf(all.map(stat => stat.scPerHour)),
    comments: bestOf(all.map(stat => stat.commentsPerStream)),
    avg: bestOf(all.map(stat => stat.avgConcurrent)),
  };

  const columns: DataColumn<ContentTypeStat>[] = [
    {
      key: "type",
      header: "类型",
      width: "9rem",
      render: stat => (
        <span className="flex w-full flex-col gap-1.5">
          <span className="flex items-baseline gap-1.5">
            <span className="font-medium text-foreground">{stat.label}</span>
            <span className="text-caption text-ink-3 tabular-nums">
              {formatPercent(stat.share * 100, 1)}
            </span>
          </span>
          <span
            aria-hidden="true"
            className="flex h-1 w-full overflow-hidden rounded-full bg-hairline"
          >
            <span
              className="block h-full rounded-full bg-member"
              style={{ width: `${Math.min(100, Math.max(0, stat.share * 100))}%` }}
            />
          </span>
        </span>
      ),
    },
    {
      key: "streams",
      header: "场次",
      align: "right",
      width: "4rem",
      sortable: true,
      render: stat =>
        accent(formatInteger(stat.streams), isBest(stat.streams, bests.streams)),
    },
    {
      key: "duration",
      header: "平均时长",
      align: "right",
      width: "6rem",
      sortable: true,
      render: stat =>
        accent(
          stat.avgDurationSec == null ? "—" : formatDurationLong(stat.avgDurationSec),
          isBest(stat.avgDurationSec, bests.duration),
        ),
    },
    {
      key: "rate",
      header: "弹幕/分",
      align: "right",
      width: "5.5rem",
      sortable: true,
      render: stat =>
        accent(formatDecimal(stat.chatPerMinute), isBest(stat.chatPerMinute, bests.rate)),
    },
    {
      key: "scPerHour",
      header: "SC/小时",
      align: "right",
      width: "5rem",
      sortable: true,
      render: stat =>
        accent(formatDecimal(stat.scPerHour), isBest(stat.scPerHour, bests.scPerHour)),
    },
    {
      key: "comments",
      header: "评论/场",
      align: "right",
      width: "5rem",
      sortable: true,
      render: stat =>
        accent(
          formatDecimal(stat.commentsPerStream),
          isBest(stat.commentsPerStream, bests.comments),
        ),
    },
    {
      key: "avg",
      header: "平均同接",
      align: "right",
      width: "5.5rem",
      sortable: true,
      render: stat =>
        stat.avgConcurrent == null ? (
          "—"
        ) : (
          <span
            className={cn(
              isBest(stat.avgConcurrent, bests.avg) && "font-semibold text-foreground",
            )}
            title={`${stat.concurrentStreams} 场有同接`}
          >
            {formatInteger(stat.avgConcurrent)}
          </span>
        ),
    },
  ];

  return (
    <DataTable
      ariaLabel="内容类型对比"
      className="min-w-[42rem]"
      columns={columns}
      empty="没有可分类的场次"
      onSort={onSort}
      rowKey={stat => stat.key}
      rows={rows}
      sort={typeSort}
      stickyFirstColumn
    />
  );
}
