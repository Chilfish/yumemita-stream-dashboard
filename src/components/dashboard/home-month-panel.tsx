import { Sparkline } from "@/components/charts/sparkline";
import { Delta } from "@/components/dashboard/delta";
import { PanelNote } from "@/components/dashboard/panel";
import { buildMonthlySeries, percentChange } from "@/lib/aggregate";
import { formatDecimal, formatInteger } from "@/lib/format";
import type { StreamSummary } from "@/types/dataset";

interface HomeMonthPanelProps {
  rows: StreamSummary[];
}

function currentMonthKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    month: "2-digit",
    timeZone: "Asia/Tokyo",
    year: "numeric",
  }).format(new Date());
}

export function HomeMonthPanel({ rows }: HomeMonthPanelProps) {
  const series = buildMonthlySeries(rows);
  const current = series.at(-1);
  const previous = series.at(-2);

  if (!current) return null;

  const counts = series.map(point => point.streams);
  const peakIndex = counts.indexOf(Math.max(...counts));
  const compareLabel = previous ? `vs ${previous.label}` : "无上月数据";
  const isRunningMonth = current.month === currentMonthKey();

  const detail = [
    { label: "场次", unit: "场", value: formatInteger(current.streams) },
    { label: "弹幕 / 分", unit: "条", value: formatDecimal(current.chatPerMinute) },
    { label: "平均同接", unit: "人", value: formatInteger(current.avgConcurrent) },
    { label: "SC 笔数", unit: "笔", value: formatInteger(current.superchats) },
    { label: "平均发言人数", unit: "人", value: formatInteger(current.avgAuthors) },
  ];

  return (
    <div className="flex min-w-0 flex-col">
      <div className="px-5 pt-4">
        <p className="text-caption text-muted-foreground">{current.label} · 自然月</p>
        <p className="mt-0.5 flex items-baseline text-title tabular-nums text-foreground">
          {formatInteger(current.streams)}
          <span className="ml-1 text-caption font-medium text-ink-3">场</span>
        </p>
        <Delta
          className="mt-1"
          compareLabel={compareLabel}
          value={previous ? percentChange(current.streams, previous.streams) : null}
        />
      </div>

      <div className="px-5 pt-3">
        <p className="text-caption text-ink-3">近 {counts.length} 个自然月 · 场次</p>
        <Sparkline
          area
          ariaLabel="最近几个自然月的场次趋势"
          height={96}
          peakIndex={peakIndex >= 0 ? peakIndex : undefined}
          values={counts}
        />
      </div>

      <dl className="px-5 pt-3">
        {detail.map(item => (
          <div
            className="flex items-baseline justify-between gap-3 border-t border-hairline py-1.5 text-footnote first:border-t-0 first:pt-0"
            key={item.label}
          >
            <dt className="min-w-0 truncate text-muted-foreground">{item.label}</dt>
            <dd className="flex shrink-0 items-baseline font-medium tabular-nums text-foreground">
              {item.value}
              <span className="ml-1 text-caption font-medium text-ink-3">{item.unit}</span>
            </dd>
          </div>
        ))}
      </dl>

      <PanelNote className="mt-auto">
        {isRunningMonth
          ? "本月尚未结束，环比仅供参考 · 按自然月；同接为空时不计入平均"
          : "按自然月；同接为空时不计入平均"}
      </PanelNote>
    </div>
  );
}
