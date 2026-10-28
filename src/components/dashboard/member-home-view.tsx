import { ChartCard } from "@/components/charts/chart-card";
import { CurrencyDonut } from "@/components/charts/currency-donut";
import { ScatterPlot } from "@/components/charts/scatter-plot";
import { StreamBars } from "@/components/charts/stream-bars";
import { StreamShapeChart } from "@/components/charts/stream-shape";
import { TopBars } from "@/components/charts/top-bars";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { StreamTable } from "@/components/dashboard/stream-table";
import { Badge } from "@/components/ui/badge";
import type { DatasetTotals } from "@/lib/aggregate";
import { formatFullDate, formatInteger } from "@/lib/format";
import type { BatchManifest, DatasetIndexEntry, StreamSummary } from "@/types/dataset";

interface MemberHomeViewProps {
  dataset: DatasetIndexEntry;
  manifest: BatchManifest;
  rows: StreamSummary[];
  totals: DatasetTotals;
  onSelectStream: (videoId: string) => void;
}

export function MemberHomeView({
  dataset,
  manifest,
  rows,
  totals,
  onSelectStream,
}: MemberHomeViewProps) {
  const sortedByDate = [...rows].sort((a, b) =>
    (a.startedAt ?? "").localeCompare(b.startedAt ?? ""),
  );
  const first = sortedByDate[0];
  const last = sortedByDate.at(-1);

  const topWords = totals.topWords.slice(0, 16).map(word => ({
    label: word.word,
    value: word.count,
    hint: `${word.count} 次 · 出现在 ${word.streams} 场`,
  }));
  const topAuthors = totals.topAuthors.slice(0, 12).map(author => ({
    label: author.author,
    value: author.messages,
    hint: `${author.messages} 条 · ${author.streams} 场`,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-heading font-semibold text-xl">{dataset.label} · 总览</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            {first && last
              ? `${formatFullDate(first.startedAt)} – ${formatFullDate(last.startedAt)} · ${manifest.scope}`
              : manifest.scope}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{totals.streamCount} 场</Badge>
          <Badge variant="outline">{totals.memberOnlyCount} 场会员限定</Badge>
          <Badge variant="outline">{formatInteger(totals.commentTotal)} 条评论</Badge>
        </div>
      </div>

      <KpiGrid totals={totals} />

      {totals.streamShape ? (
        <ChartCard
          description={`把 ${totals.streamShape.streams} 场按直播进度对齐后平均：纵轴为相对该场自身弹幕浓度的倍数（×1 = 该场均值），阴影为 25–75 分位。`}
          title="典型节奏曲线"
        >
          <StreamShapeChart shape={totals.streamShape} />
        </ChartCard>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          description={`仅显示有同接数据的 ${totals.withVstatsCount} 场；灰条为最大同接。点击柱子可跳到单场。`}
          title="每场同接"
        >
          <StreamBars onSelect={onSelectStream} rows={rows} />
        </ChartCard>

        <ChartCard
          description="按笔数构成；金额不换算汇率，只分组累计。"
          title="SC 币种构成"
        >
          <CurrencyDonut rows={totals.scByCurrency} />
        </ChartCard>

        <ChartCard
          className="xl:col-span-2"
          description="横轴为平均同接，纵轴为每千同接弹幕数；气泡大小 = 总弹幕量。点击可跳到单场。"
          title="弹幕浓度 × 同接"
        >
          <ScatterPlot onSelect={onSelectStream} rows={rows} />
        </ChartCard>

        <ChartCard
          description="按各场 Top 40 词表相加，非全量分词；只看趋势，不当精确词频。"
          title="全月高频词"
        >
          <TopBars items={topWords} />
        </ChartCard>

        <ChartCard
          className="xl:col-span-3"
          description="按各场 Top 20 发言者相加，跨场同名会合并；榜单受各场截断影响。"
          title="高频发言者"
        >
          <TopBars items={topAuthors} labelWidth={128} />
        </ChartCard>

        <ChartCard
          className="xl:col-span-3"
          description="点击行可跳到单场。"
          title="最近场次"
        >
          <StreamTable limit={8} onSelect={onSelectStream} rows={rows} />
        </ChartCard>
      </div>

      <p className="text-muted-foreground text-[11px]">
        数据生成于 {manifest.generatedAt}；同接 / 视聴时间 / 播放优先取 VSTATS，
        {totals.streamCount - totals.withVstatsCount} 场无 VSTATS，相关图表会跳过或显示“—”。
      </p>
    </div>
  );
}
