import { useMemo, useState } from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { StreamShapeChart } from "@/components/charts/stream-shape";
import { TrendLine } from "@/components/charts/trend-line";
import { DataTable, type DataColumn } from "@/components/dashboard/data-table";
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
} from "@/lib/aggregate";
import {
  formatDecimal,
  formatDurationLong,
  formatInteger,
  formatPercent,
} from "@/lib/format";
import type { StreamSummary } from "@/types/dataset";

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
      render: point => <span className="tabular-nums">{point.month}</span>,
    },
    {
      key: "streams",
      header: "场次",
      align: "right",
      width: "4rem",
      render: point => formatInteger(point.streams),
    },
    {
      key: "duration",
      header: "总时长",
      align: "right",
      width: "6rem",
      render: point =>
        point.durationSec > 0 ? formatDurationLong(point.durationSec) : "—",
    },
    {
      key: "chat",
      header: "弹幕",
      align: "right",
      width: "6rem",
      render: point => formatInteger(point.chatTotal),
    },
    {
      key: "rate",
      header: "弹幕/分",
      align: "right",
      width: "5.5rem",
      render: point => formatDecimal(point.chatPerMinute),
    },
    {
      key: "sc",
      header: "SC",
      align: "right",
      width: "3.5rem",
      render: point => formatInteger(point.superchats),
    },
    {
      key: "authors",
      header: "平均发言",
      align: "right",
      width: "5.5rem",
      render: point => formatInteger(point.avgAuthors),
    },
    {
      key: "avg",
      header: "平均同接",
      align: "right",
      width: "5.5rem",
      render: point => formatInteger(point.avgConcurrent),
    },
  ];

  const typeColumns: DataColumn<ContentTypeStat>[] = [
    {
      key: "type",
      header: "类型",
      width: "8rem",
      render: stat => (
        <span className="flex items-baseline gap-1.5">
          <span className="font-medium text-foreground">{stat.label}</span>
          <span className="text-caption text-ink-3 tabular-nums">
            {formatPercent(stat.share * 100, 1)}
          </span>
        </span>
      ),
    },
    {
      key: "streams",
      header: "场次",
      align: "right",
      width: "4rem",
      render: stat => formatInteger(stat.streams),
    },
    {
      key: "duration",
      header: "平均时长",
      align: "right",
      width: "6rem",
      render: stat =>
        stat.avgDurationSec == null ? "—" : formatDurationLong(stat.avgDurationSec),
    },
    {
      key: "rate",
      header: "弹幕/分",
      align: "right",
      width: "5.5rem",
      render: stat => formatDecimal(stat.chatPerMinute),
    },
    {
      key: "scPerHour",
      header: "SC/小时",
      align: "right",
      width: "5rem",
      render: stat => formatDecimal(stat.scPerHour),
    },
    {
      key: "comments",
      header: "评论/场",
      align: "right",
      width: "5rem",
      render: stat => formatDecimal(stat.commentsPerStream),
    },
    {
      key: "avg",
      header: "平均同接",
      align: "right",
      width: "5.5rem",
      render: stat =>
        stat.avgConcurrent == null ? (
          "—"
        ) : (
          <span title={`${stat.concurrentStreams} 场有同接`}>
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
          meta="按月聚合；总时长与弹幕是当月合计，弹幕/分与平均同接是当月均值。"
          title="月度明细"
        />
        <PanelBody flush>
          <DataTable
            ariaLabel="月度明细"
            columns={monthColumns}
            empty="没有可用的月度数据"
            rowKey={point => point.month}
            rows={series}
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHead
          meta="按标题关键词分类；比较时看比率与场均，不要只看总量。"
          title="内容类型对比"
        />
        <PanelBody flush>
          <DataTable
            ariaLabel="内容类型对比"
            columns={typeColumns}
            empty="没有可分类的场次"
            rowKey={stat => stat.key}
            rows={contentTypes}
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
