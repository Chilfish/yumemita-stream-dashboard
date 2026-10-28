import { arc, pie, type PieArcDatum } from "d3";
import { ChartCanvas } from "@/components/charts/chart-canvas";
import { EmptyChart } from "@/components/charts/chart-card";
import { CHART_COLORS } from "@/lib/chart-colors";
import type { CurrencyRow } from "@/lib/aggregate";
import { currencyLabel, formatCurrency, formatInteger } from "@/lib/format";

interface CurrencyDonutProps {
  rows: CurrencyRow[];
}

export function CurrencyDonut({ rows }: CurrencyDonutProps) {
  if (rows.length === 0) {
    return <EmptyChart height={220} message="本 dataset 没有 SC 记录" />;
  }

  const totalCount = rows.reduce((sum, row) => sum + row.count, 0);
  const arcs = pie<CurrencyRow>()
    .value(row => row.count)
    .sort(null)(rows);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <ChartCanvas ariaLabel="SC 笔数的币种构成" className="shrink-0" height={220}>
        {({ width }) => {
          const outerRadius = Math.min(84, Math.max(48, width / 2 - 8));
          const innerRadius = outerRadius * 0.62;
          const centerX = width / 2;
          const centerY = 110;
          const arcGenerator = arc<PieArcDatum<CurrencyRow>>()
            .innerRadius(innerRadius)
            .outerRadius(outerRadius)
            .padAngle(0.015)
            .cornerRadius(3);

          return (
            <g transform={`translate(${centerX},${centerY})`}>
              {arcs.map((slice, index) => (
                <path
                  d={arcGenerator(slice) ?? ""}
                  fill={CHART_COLORS[index % CHART_COLORS.length]}
                  key={slice.data.currency}
                >
                  <title>{`${currencyLabel(slice.data.currency)}：${slice.data.count} 笔 / ${formatCurrency(slice.data.currency, slice.data.amount)}`}</title>
                </path>
              ))}
              <text
                className="fill-foreground font-semibold text-lg"
                textAnchor="middle"
                y={-2}
              >
                {formatInteger(totalCount)}
              </text>
              <text
                className="fill-muted-foreground text-[10px]"
                textAnchor="middle"
                y={14}
              >
                SC 笔数
              </text>
            </g>
          );
        }}
      </ChartCanvas>

      <ul className="flex min-w-0 flex-1 flex-col gap-2">
        {rows.map((row, index) => (
          <li className="flex items-center justify-between gap-3 text-sm" key={row.currency}>
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
              />
              <span className="truncate">
                {currencyLabel(row.currency)}
                <span className="ml-1 text-muted-foreground text-xs">{row.count} 笔</span>
              </span>
            </span>
            <span className="shrink-0 font-mono text-xs">
              {formatCurrency(row.currency, row.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
