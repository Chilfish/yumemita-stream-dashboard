import { ChartCard, EmptyChart } from "@/components/charts/chart-card";
import { MultiLineChart, type ChartSeries } from "@/components/charts/multi-line-chart";
import { CopyLinkButton } from "@/components/dashboard/copy-link-button";
import { DataTable, type DataColumn } from "@/components/dashboard/data-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { Panel, PanelBody, PanelHead } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { CHART_COLORS } from "@/lib/chart-colors";
import { CONTENT_TYPES, CONTENT_TYPE_LABELS, type ContentTypeKey } from "@/lib/classify";
import { buildCompareView } from "@/lib/compare";
import {
  COMPARE_WINDOWS,
  DEFAULT_COMPARE_WINDOW,
  compareSearch,
  parseCompareParams,
} from "@/lib/compare-params";
import { formatDecimal, formatInteger } from "@/lib/format";
import { useSearchParams } from "@/lib/router-compat";
import type {
  CompareMemberStat,
  CompareMetricKey,
  CompareParams,
  GroupCompareData,
} from "@/types/compare";
import type { DatasetIndexEntry } from "@/types/dataset";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

interface GroupComparePageProps {
  datasets: DatasetIndexEntry[];
  data: GroupCompareData;
}

type NumericKey =
  | "streams"
  | "durationSec"
  | "avgConcurrent"
  | "chatPerMinute"
  | "scPerHour"
  | "commentsPerStream";

const WINDOW_LABELS: Record<(typeof COMPARE_WINDOWS)[number], string> = {
  3: "3 个月",
  6: "6 个月",
  12: "12 个月",
  all: "全部",
};

const CHART_METRICS: { key: CompareMetricKey; title: string }[] = [
  { key: "streams", title: "每月场次" },
  { key: "avgConcurrent", title: "平均同接" },
  { key: "chatPerMinute", title: "弹幕密度" },
  { key: "scPerHour", title: "SC 强度" },
];

function memberColor(member: CompareMemberStat, index: number): string {
  return member.color ?? CHART_COLORS[index % CHART_COLORS.length];
}

export function GroupComparePage({ datasets, data }: GroupComparePageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useMemo(
    () => parseCompareParams(searchParams, datasets),
    [searchParams, datasets],
  );
  const view = useMemo(
    () => buildCompareView(data.buckets, datasets, params),
    [data.buckets, datasets, params],
  );

  const allMemberIds = datasets.map(dataset => dataset.id);
  const selectedMembers = new Set(params.members);

  function writeParams(next: CompareParams): void {
    const ordered = allMemberIds.filter(id => next.members.includes(id));
    const query = new URLSearchParams(searchParams);
    // 只改对比自己的参数；`key=` 等访问参数原样保留。
    for (const key of ["members", "type", "months"]) query.delete(key);

    const encoded = new URLSearchParams(
      compareSearch({ ...next, members: ordered }, allMemberIds),
    );
    for (const [key, value] of encoded) query.set(key, value);

    setSearchParams(query, { replace: true });
  }

  function toggleMember(id: string): void {
    if (selectedMembers.has(id)) {
      if (selectedMembers.size <= 1) return;
      writeParams({ ...params, members: params.members.filter(member => member !== id) });
      return;
    }
    writeParams({ ...params, members: [...params.members, id] });
  }

  function selectType(type: ContentTypeKey | null): void {
    writeParams({ ...params, type });
  }

  const bestByKey = useMemo(() => {
    const keys: NumericKey[] = [
      "streams",
      "durationSec",
      "avgConcurrent",
      "chatPerMinute",
      "scPerHour",
      "commentsPerStream",
    ];
    const best = new Map<NumericKey, number | null>();

    for (const key of keys) {
      const values = view.members
        .map(member => member[key])
        .filter((value): value is number => value != null && Number.isFinite(value));
      best.set(key, values.length > 1 ? Math.max(...values) : null);
    }

    return best;
  }, [view.members]);

  function valueCell(member: CompareMemberStat, key: NumericKey, format: (value: number | null) => string) {
    const value = member[key];
    const best = bestByKey.get(key);
    return (
      <span
        className={cn(
          "tabular-nums",
          value != null && best != null && value === best ? "font-semibold text-foreground" : null,
        )}
      >
        {format(value)}
      </span>
    );
  }

  const columns: DataColumn<CompareMemberStat>[] = [
    {
      key: "member",
      header: "成员",
      width: "12rem",
      render: member => {
        const index = view.members.indexOf(member);
        return (
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: memberColor(member, index) }}
            />
            <span className="truncate text-foreground">{member.label}</span>
            {member.sampleSufficient || member.streams === 0 ? null : (
              <span className="rounded-full border border-hairline px-1.5 text-caption text-ink-3">
                样本 {member.streams} 场
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "streams",
      header: "场次",
      align: "right",
      width: "5.5rem",
      render: member => valueCell(member, "streams", formatInteger),
    },
    {
      key: "duration",
      header: "时长",
      align: "right",
      width: "6.5rem",
      render: member =>
        valueCell(member, "durationSec", value =>
          value == null ? "—" : `${formatDecimal(value / 3600)} 小时`),
    },
    {
      key: "avg",
      header: "平均同接",
      align: "right",
      width: "7rem",
      render: member =>
        valueCell(member, "avgConcurrent", value =>
          value == null ? "—" : formatInteger(Math.round(value))),
    },
    {
      key: "chat",
      header: "弹幕/分",
      align: "right",
      width: "6.5rem",
      render: member => valueCell(member, "chatPerMinute", formatDecimal),
    },
    {
      key: "sc",
      header: "SC/时",
      align: "right",
      width: "6rem",
      render: member => valueCell(member, "scPerHour", formatDecimal),
    },
    {
      key: "comments",
      header: "评论/场",
      align: "right",
      width: "7rem",
      render: member => valueCell(member, "commentsPerStream", formatDecimal),
    },
  ];

  const isDefault =
    params.members.length === allMemberIds.length &&
    params.type == null &&
    params.months === DEFAULT_COMPARE_WINDOW;

  const monthStep = Math.max(1, Math.ceil(view.months.length / 6));
  const xTickValues = view.months
    .map((_, index) => index)
    .filter(index => index % monthStep === 0 || index === view.months.length - 1);

  function seriesFor(key: CompareMetricKey): ChartSeries[] {
    const metric = view.series.find(item => item.key === key);
    if (!metric) return [];

    return view.members.map((member, index) => ({
      color: memberColor(member, index),
      id: member.id,
      label: member.label,
      shortLabel: member.label,
      values: metric.values[member.id] ?? [],
    }));
  }

  const windowLabel = WINDOW_LABELS[params.months];
  const typeLabel = params.type ? CONTENT_TYPE_LABELS[params.type] : "全部类型";
  const hasData = view.totals.streams > 0;
  const canChart = hasData && view.months.length >= 2;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        actions={<CopyLinkButton />}
        eyebrow="全组"
        facts={[
          { value: view.members.length, label: "位成员" },
          { value: formatInteger(view.totals.streams), label: "场" },
          { value: typeLabel, label: "内容类型" },
          { value: windowLabel, label: "时间范围" },
        ]}
        title="全员对比"
      />

      <Panel>
        <PanelHead
          actions={
            isDefault ? null : (
              <Button
                onClick={() =>
                  writeParams({
                    members: allMemberIds,
                    type: null,
                    months: DEFAULT_COMPARE_WINDOW,
                  })}
                size="sm"
                type="button"
                variant="ghost"
              >
                重置
              </Button>
            )
          }
          eyebrow="同一时间段 · 同一内容类型"
          meta="筛选会写进 URL，可直接分享当前对比"
          title="对比范围"
        />
        <PanelBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-footnote text-muted-foreground">成员</p>
            <div className="flex flex-wrap gap-2">
              {datasets.map(dataset => {
                const checked = selectedMembers.has(dataset.id);
                const disabled = checked && selectedMembers.size <= 1;
                return (
                  <Label
                    className={cn(
                      "flex min-h-9 items-center gap-2 rounded-control border border-hairline px-3 py-1 font-normal transition-colors duration-120 ease-out",
                      disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-accent/60",
                    )}
                    key={dataset.id}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={() => toggleMember(dataset.id)}
                    />
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full"
                      style={{ backgroundColor: dataset.color ?? CHART_COLORS[1] }}
                    />
                    <span className="text-footnote text-foreground">{dataset.label}</span>
                  </Label>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex max-w-full items-center gap-2">
              <span className="shrink-0 whitespace-nowrap text-footnote text-muted-foreground">
                内容类型
              </span>
              <div className="min-w-0 max-w-full overflow-x-auto">
                <SegmentedControl aria-label="内容类型">
                  <SegmentedControlItem
                    aria-current={params.type == null ? "page" : undefined}
                    onClick={() => selectType(null)}
                  >
                    全部
                  </SegmentedControlItem>
                  {CONTENT_TYPES.map(type => (
                    <SegmentedControlItem
                      aria-current={params.type === type ? "page" : undefined}
                      key={type}
                      onClick={() => selectType(type)}
                    >
                      {CONTENT_TYPE_LABELS[type]}
                    </SegmentedControlItem>
                  ))}
                </SegmentedControl>
              </div>
            </div>

            <div className="flex max-w-full items-center gap-2">
              <span className="shrink-0 whitespace-nowrap text-footnote text-muted-foreground">
                时间范围
              </span>
              <div className="min-w-0 max-w-full overflow-x-auto">
                <SegmentedControl aria-label="时间范围">
                  {COMPARE_WINDOWS.map(months => (
                    <SegmentedControlItem
                      aria-current={params.months === months ? "page" : undefined}
                      key={months}
                      onClick={() => writeParams({ ...params, months })}
                    >
                      {WINDOW_LABELS[months]}
                    </SegmentedControlItem>
                  ))}
                </SegmentedControl>
              </div>
            </div>
          </div>
        </PanelBody>
      </Panel>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-headline text-foreground">指标矩阵</h2>
          <p className="text-caption text-ink-3">加粗为同期最高值</p>
        </div>
        {hasData ? (
          <>
            <DataTable
              ariaLabel="所选成员与时间范围的指标对比"
              columns={columns}
              rowKey={member => member.id}
              rows={view.members}
            />
            <p className="text-caption text-ink-3">
              样本少于 {view.sampleMin} 场的成员会标注「样本 n 场」，数值仅供参考；图表里没有场次的月份留空。
            </p>
          </>
        ) : (
          <EmptyChart
            hint="换一个内容类型，或者把时间范围改成「全部」。"
            message="这个筛选下没有可对比的场次"
          />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-headline text-foreground">月度走势</h2>
        {canChart ? (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {CHART_METRICS.map(metric => {
              const series = seriesFor(metric.key);
              const copy = view.series.find(item => item.key === metric.key);
              return (
                <ChartCard
                  description={copy ? `单位：${copy.unit}` : undefined}
                  key={metric.key}
                  title={metric.title}
                >
                  <MultiLineChart
                    ariaLabel={`${metric.title}：所选成员的月度对比`}
                    emptyMessage="这个指标在所选范围里没有数据。"
                    series={series}
                    xLabel="月份"
                    xTickFormat={value => view.months[value]?.slice(2) ?? ""}
                    xTickValues={xTickValues}
                  />
                </ChartCard>
              );
            })}
          </div>
        ) : (
          <EmptyChart
            hint="至少需要两个有场次的月份才能画趋势；扩大时间范围再试。"
            message={hasData ? "时间范围里只有一个月的场次" : "没有可以画趋势的数据"}
          />
        )}
      </section>
    </div>
  );
}
