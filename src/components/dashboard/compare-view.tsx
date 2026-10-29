import { useMemo } from "react";
import { ChartFrame } from "@/components/charts/chart-frame";
import { MultiLineChart, type ChartSeries } from "@/components/charts/multi-line-chart";
import { CopyLinkButton } from "@/components/dashboard/copy-link-button";
import { DataTable, type DataColumn } from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { Panel, PanelBody, PanelHead, PanelNote } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { PackStatus } from "@/hooks/use-stream-packs";
import { CHART_COLORS } from "@/lib/chart-colors";
import { formatDate, formatDuration, formatInteger, formatPercent } from "@/lib/format";
import { MAX_COMPARE } from "@/lib/routes";
import type { StreamDatapack } from "@/types/datapack";
import type { StreamSummary } from "@/types/dataset";
import { cn } from "@/lib/utils";

interface CompareViewProps {
  /** 成员名，用于页面头的 eyebrow。 */
  datasetLabel: string;
  rows: StreamSummary[];
  selectedIds: string[];
  onToggle: (videoId: string) => void;
  onReset?: () => void;
  packs: Map<string, StreamDatapack>;
  packStatus: PackStatus;
  packError: string | null;
}

interface Metric {
  key: string;
  label: string;
  /** 单位降一级展示，不混进数值。 */
  unit?: string;
  value: (row: StreamSummary) => number | null;
  format: (value: number | null) => string;
}

const METRICS: Metric[] = [
  {
    key: "duration",
    label: "时长",
    value: row => row.durationSec,
    format: value => formatDuration(value),
  },
  { key: "avg", label: "平均同接", value: row => row.avgConcurrent, format: formatInteger },
  { key: "max", label: "最大同接", value: row => row.maxConcurrent, format: formatInteger },
  {
    key: "watch",
    label: "视聴时间",
    unit: "人·时",
    value: row => row.watchTimeHours,
    format: formatInteger,
  },
  {
    key: "views",
    label: "播放",
    value: row => row.vstatsViews ?? row.snapshotViews,
    format: formatInteger,
  },
  {
    key: "likeRate",
    label: "点赞率",
    value: row => (row.likesPer1000Views != null ? row.likesPer1000Views / 10 : null),
    format: value => formatPercent(value, 2),
  },
  { key: "chat", label: "弹幕", value: row => row.chatTotal, format: formatInteger },
  { key: "authors", label: "发言人数", value: row => row.uniqueAuthors, format: formatInteger },
  {
    key: "chatPer1000",
    label: "每千同接弹幕",
    unit: "条",
    value: row => row.chatPer1000AvgViewers,
    format: value => (value == null ? "—" : formatInteger(Math.round(value))),
  },
  {
    key: "sc",
    label: "SC",
    unit: "笔",
    value: row => row.superchats,
    format: formatInteger,
  },
  { key: "comments", label: "评论", value: row => row.commentsCaptured, format: formatInteger },
];

interface BestValue {
  best: number | null;
  count: number;
}

function bestValue(metric: Metric, selected: StreamSummary[]): BestValue {
  const numeric = selected
    .map(metric.value)
    .filter((value): value is number => value != null && Number.isFinite(value));
  return {
    best: numeric.length > 0 ? Math.max(...numeric) : null,
    count: numeric.length,
  };
}

export function CompareView({
  datasetLabel,
  rows,
  selectedIds,
  onToggle,
  onReset,
  packs,
  packStatus,
  packError,
}: CompareViewProps) {
  const selected = useMemo(
    () =>
      selectedIds
        .map(id => rows.find(row => row.videoId === id))
        .filter((row): row is StreamSummary => row != null),
    [rows, selectedIds],
  );

  const series = useMemo<ChartSeries[]>(
    () =>
      selected
        .map((row): ChartSeries | null => {
          const pack = packs.get(row.videoId);
          if (!pack) return null;
          return {
            id: row.videoId,
            label: `${formatDate(row.startedAt)} ${row.title}`,
            shortLabel: formatDate(row.startedAt),
            values: pack.chat.density.perMinute,
            color: CHART_COLORS[selected.indexOf(row) % CHART_COLORS.length],
          };
        })
        .filter((item): item is ChartSeries => item != null),
    [selected, packs],
  );

  const atLimit = selectedIds.length >= MAX_COMPARE;

  const columns = useMemo<DataColumn<Metric>[]>(() => {
    const bests = new Map(
      METRICS.map(metric => [metric.key, bestValue(metric, selected)] as const),
    );

    return [
      {
        key: "metric",
        header: "指标",
        width: "11.5rem",
        render: metric => (
          <span className="flex items-baseline gap-1">
            <span className="text-muted-foreground">{metric.label}</span>
            {metric.unit ? <span className="text-caption text-ink-3">{metric.unit}</span> : null}
          </span>
        ),
      },
      ...selected.map(row => ({
        key: row.videoId,
        align: "right" as const,
        width: "11rem",
        header: (
          <span className="flex min-w-0 flex-col items-end gap-0.5 py-1 normal-case">
            <span className="text-caption font-medium text-ink-3 tabular-nums">
              {formatDate(row.startedAt)}
            </span>
            <span className="block max-w-40 truncate text-footnote font-normal text-foreground">
              {row.title}
            </span>
          </span>
        ),
        render: (metric: Metric) => {
          const value = metric.value(row);
          const best = bests.get(metric.key);
          const marked =
            value != null && best?.best != null && best.count > 1 && value === best.best;

          return (
            <span className={cn("tabular-nums", marked ? "font-semibold text-foreground" : null)}>
              {metric.format(value)}
            </span>
          );
        },
      })),
    ];
  }, [selected]);

  const chartPlaceholder =
    packStatus === "loading"
      ? "正在加载所选场次的逐分钟明细…"
      : packStatus === "error"
        ? `逐分钟明细加载失败：${packError ?? "未知错误"}`
        : selected.length < 2
          ? "至少选择 2 场才能叠加对比。"
          : "所选场次还没有可用的逐分钟数据。";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        actions={<CopyLinkButton />}
        eyebrow={datasetLabel}
        facts={[
          { value: `${selected.length} / ${MAX_COMPARE}`, label: "已选场次" },
          { value: rows.length, label: "场可选" },
        ]}
        title="对比"
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[18.75rem_minmax(0,1fr)]">
        <Panel className="self-start">
          <PanelHead
            actions={
              selected.length > 0 && onReset ? (
                <Button onClick={onReset} size="sm" type="button" variant="ghost">
                  清空
                </Button>
              ) : null
            }
            eyebrow="选择场次"
            meta={`已选 ${selected.length} / ${MAX_COMPARE}`}
            title="叠加哪些场次"
          />
          <PanelBody flush>
            <ScrollArea className="h-64 sm:h-80 xl:h-[33.75rem]">
              <ul className="divide-y divide-hairline">
                {rows.map(row => {
                  const checked = selectedIds.includes(row.videoId);
                  const disabled = !checked && atLimit;

                  return (
                    <li key={row.videoId}>
                      <Label
                        className={cn(
                          "flex w-full items-start gap-2.5 px-4 py-2 font-normal text-footnote transition-colors duration-120 ease-out",
                          disabled
                            ? "cursor-not-allowed opacity-45"
                            : "cursor-pointer hover:bg-accent/60",
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          className="mt-0.5"
                          disabled={disabled}
                          onCheckedChange={() => onToggle(row.videoId)}
                        />
                        <span className="min-w-0">
                          <span className="block text-caption text-ink-3 tabular-nums">
                            {formatDate(row.startedAt)}
                          </span>
                          <span className="mt-0.5 block truncate text-foreground">
                            {row.title}
                          </span>
                        </span>
                      </Label>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          </PanelBody>
          <PanelNote>
            {atLimit
              ? "已达上限：取消一场后可继续勾选。"
              : "最多选 4 场；勾选状态写入 URL，可直接分享这组对比。"}
          </PanelNote>
        </Panel>

        <div className="flex min-w-0 flex-col gap-6">
          <ChartFrame
            meta="横轴按开播后分钟对齐，纵轴为每分钟弹幕条数；悬停查看同一分钟各场的数值。"
            note="时长不同的场次各画到自己的最后分钟；少于 2 场时不画线。"
            title="逐分钟弹幕对比"
          >
            {series.length >= 2 ? (
              <MultiLineChart ariaLabel="所选场次的逐分钟弹幕对比" series={series} />
            ) : (
              <p className="py-12 text-center text-footnote text-muted-foreground">
                {chartPlaceholder}
              </p>
            )}
          </ChartFrame>

          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-headline text-foreground">指标对比</h2>
              <p className="text-caption text-ink-3">加粗 = 该指标最高；并列时同时加粗。</p>
            </div>
            {selected.length === 0 ? (
              <p className="py-6 text-footnote text-muted-foreground">
                还没有选择场次：在左侧勾选 2–4 场开始对比。
              </p>
            ) : (
              <DataTable
                ariaLabel="所选场次的指标对比"
                columns={columns}
                rowKey={metric => metric.key}
                rows={METRICS}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
