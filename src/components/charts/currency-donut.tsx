import { arc, pie, type PieArcDatum } from "d3";
import { ChartCanvas } from "@/components/charts/chart-canvas";
import { CHART_COLORS } from "@/lib/chart-colors";
import type { CurrencyRow } from "@/lib/aggregate";
import { currencyLabel, formatCurrency, formatInteger } from "@/lib/format";

interface CurrencyDonutProps {
  rows: CurrencyRow[];
}

/**
 * 单色相阶梯：成员色 + 逐级透明度，保证整张图只有一个色相；
 * 币种名称与金额始终以列表形式直接给出，不依赖颜色辨识。
 */
const SLICE_OPACITY = [1, 0.84, 0.7, 0.56, 0.44, 0.34, 0.26, 0.18] as const;

function sliceOpacity(index: number): number {
  return SLICE_OPACITY[index] ?? 0.16;
}

export function CurrencyDonut({ rows }: CurrencyDonutProps) {
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-footnote text-muted-foreground">
        本场没有 SC 记录，币种构成留空。
      </p>
    );
  }

  const totalCount = rows.reduce((sum, row) => sum + row.count, 0);
  const arcs = pie<CurrencyRow>()
    .value(row => row.count)
    .sort(null)(rows);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <ChartCanvas ariaLabel="SC 笔数的币种构成" className="w-[220px] shrink-0" height={220}>
        {({ width }) => {
          const outerRadius = Math.min(84, Math.max(48, width / 2 - 8));
          const innerRadius = outerRadius * 0.62;
          const arcGenerator = arc<PieArcDatum<CurrencyRow>>()
            .innerRadius(innerRadius)
            .outerRadius(outerRadius)
            .padAngle(0.015)
            .cornerRadius(3);

          return (
            <g transform={`translate(${width / 2},110)`}>
              {arcs.map((slice, index) => (
                <path
                  d={arcGenerator(slice) ?? ""}
                  fill={CHART_COLORS[0]}
                  fillOpacity={sliceOpacity(index)}
                  key={slice.data.currency}
                >
                  <title>{`${currencyLabel(slice.data.currency)}：${slice.data.count} 笔 / ${formatCurrency(slice.data.currency, slice.data.amount)}`}</title>
                </path>
              ))}
              <text
                className="fill-foreground text-title tabular-nums"
                dominantBaseline="middle"
                textAnchor="middle"
                y={-6}
              >
                {formatInteger(totalCount)}
              </text>
              <text className="fill-ink-3 text-caption" textAnchor="middle" y={16}>
                SC 笔数
              </text>
            </g>
          );
        }}
      </ChartCanvas>

      <ul className="flex min-w-0 flex-1 flex-col divide-y divide-hairline">
        {rows.map((row, index) => (
          <li className="flex items-center justify-between gap-3 py-1.5 text-footnote" key={row.currency}>
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: CHART_COLORS[0], opacity: sliceOpacity(index) }}
              />
              <span className="truncate">
                {currencyLabel(row.currency)}
                <span className="ml-1.5 text-caption text-ink-3 tabular-nums">{row.count} 笔</span>
              </span>
            </span>
            <span className="shrink-0 text-caption font-semibold text-foreground tabular-nums">
              {formatCurrency(row.currency, row.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
