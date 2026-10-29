import { Delta } from "@/components/dashboard/delta";
import { buildMonthlySeries, percentChange } from "@/lib/aggregate";
import { formatDecimal, formatInteger } from "@/lib/format";
import type { StreamSummary } from "@/types/dataset";

interface HomeMonthPanelProps {
  rows: StreamSummary[];
}

export function HomeMonthPanel({ rows }: HomeMonthPanelProps) {
  const series = buildMonthlySeries(rows);
  const current = series.at(-1);
  const previous = series.at(-2);

  if (!current) return null;

  const compareLabel = previous ? `vs ${previous.label}` : "无上月数据";

  const detail = [
    { label: "弹幕 / 分", unit: "条", value: formatDecimal(current.chatPerMinute) },
    { label: "平均同接", unit: "人", value: formatInteger(current.avgConcurrent) },
    { label: "SC 笔数", unit: "笔", value: formatInteger(current.superchats) },
    { label: "平均发言人数", unit: "人", value: formatInteger(current.avgAuthors) },
  ];

  return (
    <div className="flex min-w-0 flex-col px-5 pt-4 pb-5">
      <p className="text-caption text-muted-foreground">{current.label} · 自然月</p>
      <p className="mt-1 flex items-baseline text-stat tabular-nums text-foreground">
        {formatInteger(current.streams)}
        <span className="ml-1 text-caption font-medium text-ink-3">场</span>
      </p>
      <Delta className="mt-1" compareLabel={compareLabel} value={previous ? percentChange(current.streams, previous.streams) : null} />

      <dl className="mt-4 border-t border-hairline">
        {detail.map(item => (
          <div
            className="flex items-baseline justify-between gap-3 border-b border-hairline py-1.5 text-footnote last:border-b-0"
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
    </div>
  );
}
