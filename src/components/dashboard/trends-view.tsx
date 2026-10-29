import { type ReactNode, useMemo, useState } from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { StreamShapeChart } from "@/components/charts/stream-shape";
import { TrendLine } from "@/components/charts/trend-line";
import { DataTable, type DataColumn } from "@/components/dashboard/data-table";
import { Delta } from "@/components/dashboard/delta";
import { PageHeader, type Fact } from "@/components/dashboard/page-header";
import { Panel, PanelBody, PanelHead, PanelNote } from "@/components/dashboard/panel";
import { TopAuthors } from "@/components/dashboard/top-authors";
import { TopWords } from "@/components/dashboard/top-words";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  buildContentTypeStats,
  buildMonthlySeries,
  type ContentTypeStat,
  type DatasetTotals,
  type MonthlyPoint,
  percentChange,
} from "@/lib/aggregate";
import {
  formatDecimal,
  formatDurationLong,
  formatInteger,
  formatPercent,
} from "@/lib/format";
import type { StreamSummary } from "@/types/dataset";
import { cn } from "@/lib/utils";

interface TrendsViewProps {
  rows: StreamSummary[];
  totals: DatasetTotals;
}

type TrendMetric = "avgConcurrent" | "chatPerMinute" | "streams" | "superchats";

const METRIC_OPTIONS: { value: TrendMetric; label: string; unit: string }[] = [
  { value: "streams", label: "场次", unit: "场" },
  { value: "chatPerMinute", label: "弹幕/分", unit: "条/分" },
  { value: "superchats", label: "SC", unit: "笔" },
  { value: "avgConcurrent", label: "平均同接", unit: "人" },
];

function isTrendMetric(value: string | undefined): value is TrendMetric {
  return METRIC_OPTIONS.some(option => option.value === value);
}

function metricValue(point: MonthlyPoint, metric: TrendMetric): number | null {
  switch (metric) {
    case "streams":
      return point.streams;
    case "chatPerMinute":
      return point.chatPerMinute;
    case "superchats":
      return point.superchats;
    case "avgConcurrent":
      return point.avgConcurrent;
  }
}

type MonthSortKey =
  | "month"
  | "streams"
  | "duration"
  | "chat"
  | "rate"
  | "sc"
  | "authors"
  | "avg";
type TypeSortKey = "streams" | "duration" | "rate" | "scPerHour" | "comments" | "avg";

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

interface SortState<K extends string> {
  key: K;
  dir: "asc" | "desc";
}

interface BestValue {
  value: number | null;
  count: number;
}

function isMonthSortKey(value: string): value is MonthSortKey {
  return MONTH_SORT_KEYS.includes(value as MonthSortKey);
}

function isTypeSortKey(value: string): value is TypeSortKey {
  return TYPE_SORT_KEYS.includes(value as TypeSortKey);
}

function toggleSort<K extends string>(current: SortState<K>, key: K): SortState<K> {
  if (current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: "desc" };
}

function monthSortValue(point: MonthlyPoint, key: MonthSortKey): number | null {
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

function typeSortValue(stat: ContentTypeStat, key: TypeSortKey): number | null {
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
function sortBy<T>(
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

function bestOf(values: (number | null)[]): BestValue {
  const numeric = values.filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  return {
    value: numeric.length > 0 ? Math.max(...numeric) : null,
    count: numeric.length,
  };
}

function isBest(value: number | null, best: BestValue): boolean {
  return value != null && best.value != null && best.count > 1 && value === best.value;
}

function accent(value: string, highlighted: boolean): ReactNode {
  return (
    <span className={cn(highlighted && "font-semibold text-foreground")}>{value}</span>
  );
}

export function TrendsView({ rows, totals }: TrendsViewProps) {
  const series = useMemo(
    () => buildMonthlySeries(rows, Math.max(1, rows.length)),
    [rows],
  );
  const contentTypes = useMemo(() => buildContentTypeStats(rows), [rows]);
  const [metric, setMetric] = useState<TrendMetric>("chatPerMinute");
  const active =
    METRIC_OPTIONS.find(option => option.value === metric) ?? METRIC_OPTIONS[1]!;
  const formatValue = metric === "chatPerMinute" ? formatDecimal : formatInteger;
  const [monthSort, setMonthSort] = useState<SortState<MonthSortKey>>({
    key: "month",
    dir: "asc",
  });
  const [typeSort, setTypeSort] = useState<SortState<TypeSortKey>>({
    key: "streams",
    dir: "desc",
  });

  const deltaByMonth = useMemo(() => {
    const map = new Map<string, { value: number | null; label: string }>();
    series.forEach((point, index) => {
      const previous = index > 0 ? series[index - 1] : undefined;
      map.set(point.month, {
        value: percentChange(
          metricValue(point, metric),
          previous ? metricValue(previous, metric) : null,
        ),
        label: previous ? `vs ${previous.label}` : "无上月",
      });
    });
    return map;
  }, [series, metric]);

  const sortedSeries = useMemo(
    () => sortBy(series, monthSort.dir, point => monthSortValue(point, monthSort.key)),
    [series, monthSort],
  );

  const sortedTypes = useMemo(
    () => sortBy(contentTypes, typeSort.dir, stat => typeSortValue(stat, typeSort.key)),
    [contentTypes, typeSort],
  );

  const typeBests = useMemo(
    () => ({
      streams: bestOf(contentTypes.map(stat => stat.streams)),
      duration: bestOf(contentTypes.map(stat => stat.avgDurationSec)),
      rate: bestOf(contentTypes.map(stat => stat.chatPerMinute)),
      scPerHour: bestOf(contentTypes.map(stat => stat.scPerHour)),
      comments: bestOf(contentTypes.map(stat => stat.commentsPerStream)),
      avg: bestOf(contentTypes.map(stat => stat.avgConcurrent)),
    }),
    [contentTypes],
  );

  const monthSummary = useMemo<Record<string, ReactNode>>(() => {
    const streams = series.reduce((sum, point) => sum + point.streams, 0);
    const durationSec = series.reduce((sum, point) => sum + point.durationSec, 0);
    const chatTotal = series.reduce((sum, point) => sum + point.chatTotal, 0);
    const superchats = series.reduce((sum, point) => sum + point.superchats, 0);
    const authorWeight = series.reduce(
      (sum, point) => sum + (point.avgAuthors ?? 0) * point.streams,
      0,
    );
    const authorStreams = series.reduce(
      (sum, point) => sum + (point.avgAuthors == null ? 0 : point.streams),
      0,
    );
    const concurrent = rows.filter(row => row.avgConcurrent != null);

    return {
      month: "合计",
      delta: <span className="text-ink-3">—</span>,
      streams: formatInteger(streams),
      duration: durationSec > 0 ? formatDurationLong(durationSec) : "—",
      chat: formatInteger(chatTotal),
      rate: formatDecimal(durationSec > 0 ? chatTotal / (durationSec / 60) : null),
      sc: formatInteger(superchats),
      authors: formatInteger(authorStreams > 0 ? authorWeight / authorStreams : null),
      avg:
        concurrent.length > 0 ? (
          <span title={`全期 ${concurrent.length} 场有同接场次的平均值`}>
            {formatInteger(
              concurrent.reduce((sum, row) => sum + (row.avgConcurrent ?? 0), 0) /
                concurrent.length,
            )}
          </span>
        ) : (
          "—"
        ),
    };
  }, [series, rows]);

  function handleMonthSort(key: string): void {
    if (!isMonthSortKey(key)) return;
    setMonthSort(current => toggleSort(current, key));
  }

  function handleTypeSort(key: string): void {
    if (!isTypeSortKey(key)) return;
    setTypeSort(current => toggleSort(current, key));
  }

  const points = series.map(point => {
    const value = metricValue(point, metric);
    return {
      label: point.month,
      value,
      hint:
        value == null
          ? `${point.month}：没有数据`
          : `${point.month} · ${formatValue(value)} ${active.unit} · ${formatInteger(point.streams)} 场`,
    };
  });

  const facts: Fact[] = [
    { value: formatInteger(rows.length), label: "场" },
    { value: formatInteger(series.length), label: "个月" },
    { value: formatInteger(totals.chatTotal), label: "弹幕" },
    { value: formatInteger(totals.chatByKind.superchat), label: "SC" },
    { value: formatInteger(totals.withVstatsCount), label: "场有同接" },
  ];

  const monthColumns: DataColumn<MonthlyPoint>[] = [
    {
      key: "month",
      header: "月份",
      width: "6rem",
      sortable: true,
      render: point => <span className="tabular-nums">{point.month}</span>,
    },
    {
      key: "delta",
      header: `${active.label} 环比`,
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

  const typeColumns: DataColumn<ContentTypeStat>[] = [
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
        accent(formatInteger(stat.streams), isBest(stat.streams, typeBests.streams)),
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
          isBest(stat.avgDurationSec, typeBests.duration),
        ),
    },
    {
      key: "rate",
      header: "弹幕/分",
      align: "right",
      width: "5.5rem",
      sortable: true,
      render: stat =>
        accent(formatDecimal(stat.chatPerMinute), isBest(stat.chatPerMinute, typeBests.rate)),
    },
    {
      key: "scPerHour",
      header: "SC/小时",
      align: "right",
      width: "5rem",
      sortable: true,
      render: stat =>
        accent(formatDecimal(stat.scPerHour), isBest(stat.scPerHour, typeBests.scPerHour)),
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
          isBest(stat.commentsPerStream, typeBests.comments),
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
              isBest(stat.avgConcurrent, typeBests.avg) &&
                "font-semibold text-foreground",
            )}
            title={`${stat.concurrentStreams} 场有同接`}
          >
            {formatInteger(stat.avgConcurrent)}
          </span>
        ),
    },
  ];

  const metricNote =
    metric === "avgConcurrent"
      ? `只有 ${formatInteger(totals.withVstatsCount)} 场有 VSTATS 同接；没有数据的月份会断开折线。`
      : "按月聚合；悬停数据点查看当月读数。";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="按月聚合 · 内容类型对比"
        facts={facts}
        title="趋势"
      />

      <ChartCard
        action={
          <ToggleGroup
            aria-label="趋势指标"
            onValueChange={next => {
              const [value] = next;
              if (isTrendMetric(value)) setMetric(value);
            }}
            size="sm"
            value={[metric]}
          >
            {METRIC_OPTIONS.map(option => (
              <ToggleGroupItem
                className="rounded-full px-2.5 text-footnote text-muted-foreground before:rounded-full hover:text-foreground data-pressed:bg-foreground data-pressed:text-background data-pressed:hover:bg-foreground data-pressed:hover:text-background"
                key={option.value}
                value={option.value}
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
        description={`${active.unit} · ${metricNote}`}
        title="月度趋势"
      >
        <TrendLine
          ariaLabel={`${active.label}的月度趋势`}
          points={points}
          unit={active.unit}
          valueFormat={formatValue}
        />
      </ChartCard>

      <Panel>
        <PanelHead
          meta="按月聚合；点击表头排序，环比对应当前所选指标，合计行为全期汇总。"
          title="月度明细"
        />
        <PanelBody className="px-2.5 pb-0">
          <DataTable
            ariaLabel="月度明细"
            className="min-w-[46rem]"
            columns={monthColumns}
            empty="没有可用的月度数据"
            onSort={handleMonthSort}
            rowKey={point => point.month}
            rows={sortedSeries}
            sort={monthSort}
            stickyFirstColumn
            summary={monthSummary}
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHead
          meta="按标题关键词分类；点击表头排序，加粗为该列最高，比较时看比率与场均。"
          title="内容类型对比"
        />
        <PanelBody className="px-2.5 pb-0">
          <DataTable
            ariaLabel="内容类型对比"
            className="min-w-[42rem]"
            columns={typeColumns}
            empty="没有可分类的场次"
            onSort={handleTypeSort}
            rowKey={stat => stat.key}
            rows={sortedTypes}
            sort={typeSort}
            stickyFirstColumn
          />
        </PanelBody>
        <PanelNote>
          自动分类，仅供参考；未匹配关键词的标题计入「杂谈」。
        </PanelNote>
      </Panel>

      {totals.streamShape ? (
        <ChartCard
          description={`把 ${totals.streamShape.streams} 场按直播进度对齐后平均：纵轴为相对该场自身弹幕浓度的倍数（×1 = 该场均值），阴影为 25–75 分位。`}
          title="典型节奏曲线"
        >
          <StreamShapeChart shape={totals.streamShape} />
        </ChartCard>
      ) : null}

      <Panel>
        <div className="grid grid-cols-1 divide-y divide-hairline lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <TopWords words={totals.topWords} />
          <TopAuthors authors={totals.topAuthors} />
        </div>
      </Panel>
    </div>
  );
}
