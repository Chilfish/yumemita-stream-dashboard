import { type ReactNode, useMemo, useState } from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { StreamShapeChart } from "@/components/charts/stream-shape";
import { TrendLine } from "@/components/charts/trend-line";
import { PageHeader, type Fact } from "@/components/dashboard/primitives/page-header";
import { Panel, PanelBody, PanelHead } from "@/components/dashboard/primitives/panel";
import { TopAuthors } from "@/components/dashboard/trends/top-authors";
import { TopWords } from "@/components/dashboard/trends/top-words";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  buildContentTypeStats,
  buildMonthlySeries,
  type DatasetTotals,
  type MonthlyPoint,
} from "@/lib/aggregate";
import { formatDecimal, formatDurationLong, formatInteger } from "@/lib/format";
import type { StreamSummary } from "@/types/dataset";
import { METRIC_OPTIONS, type TrendMetric, isTrendMetric, metricValue } from "./trends-metrics";
import {
  type MonthSortKey,
  type SortState,
  type TypeSortKey,
  isMonthSortKey,
  isTypeSortKey,
  monthSortValue,
  sortBy,
  toggleSort,
  typeSortValue,
} from "./trends-sort";
import { MonthTable, TypeTable } from "./trends-tables";

interface TrendsViewProps {
  rows: StreamSummary[];
  totals: DatasetTotals;
}

/** 月度合计行：整段区间一次求和，平均同接按有同接的场次加权。 */
function buildMonthSummary(
  series: MonthlyPoint[],
  rows: StreamSummary[],
): Record<string, ReactNode> {
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

  const sortedSeries = useMemo(
    () => sortBy(series, monthSort.dir, point => monthSortValue(point, monthSort.key)),
    [series, monthSort],
  );

  const sortedTypes = useMemo(
    () => sortBy(contentTypes, typeSort.dir, stat => typeSortValue(stat, typeSort.key)),
    [contentTypes, typeSort],
  );

  const monthSummary = useMemo(() => buildMonthSummary(series, rows), [series, rows]);

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

  const metricNote =
    metric === "avgConcurrent"
      ? `${formatInteger(totals.withVstatsCount)} 场有同接`
      : null;

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
        description={metricNote ? `${active.unit} · ${metricNote}` : active.unit}
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
        <PanelHead title="月度明细" />
        <PanelBody className="px-2.5 pb-0">
          <MonthTable
            metric={metric}
            metricLabel={active.label}
            monthSort={monthSort}
            onSort={handleMonthSort}
            rows={sortedSeries}
            series={series}
            summary={monthSummary}
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHead title="内容类型对比" />
        <PanelBody className="px-2.5 pb-0">
          <TypeTable
            all={contentTypes}
            onSort={handleTypeSort}
            rows={sortedTypes}
            typeSort={typeSort}
          />
        </PanelBody>
      </Panel>

      {totals.streamShape ? (
        <ChartCard
          description={`按直播进度对齐的 ${totals.streamShape.streams} 场平均；阴影为中间 50% 的范围。`}
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
