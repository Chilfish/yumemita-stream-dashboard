import { max, scaleBand, scaleLinear } from "d3";
import { ChartCanvas } from "@/components/charts/chart-canvas";
import { EmptyChart } from "@/components/charts/chart-card";
import { CHART_COLORS } from "@/lib/chart-colors";
import { formatCompact } from "@/lib/format";

export interface TopBarItem {
  label: string;
  value: number;
  hint?: string;
}

interface TopBarsProps {
  items: TopBarItem[];
  emptyMessage?: string;
  valueLabel?: (value: number) => string;
  color?: string;
  labelWidth?: number;
}

function truncate(text: string, length = 14): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

export function TopBars({
  items,
  emptyMessage = "暂无数据",
  valueLabel = formatCompact,
  color = CHART_COLORS[0],
  labelWidth = 112,
}: TopBarsProps) {
  if (items.length === 0) {
    return <EmptyChart height={180} message={emptyMessage} />;
  }

  const maxValue = max(items, item => item.value) ?? 1;
  const rowHeight = 26;
  const height = items.length * rowHeight + 8;

  return (
    <ChartCanvas ariaLabel="Top 排行条形图" height={height}>
      {({ width }) => {
        const margin = { top: 4, right: 56, bottom: 4, left: labelWidth };
        const innerWidth = Math.max(0, width - margin.left - margin.right);
        const innerHeight = Math.max(0, height - margin.top - margin.bottom);
        const x = scaleLinear().domain([0, maxValue]).range([0, innerWidth]);
        const y = scaleBand()
          .domain(items.map(item => item.label))
          .range([0, innerHeight])
          .paddingInner(0.24);

        return (
          <g transform={`translate(${margin.left},${margin.top})`}>
            {items.map(item => {
              const bandY = y(item.label) ?? 0;
              const barWidth = Math.max(2, x(item.value));
              return (
                <g key={item.label}>
                  <text
                    className="fill-foreground text-[11px]"
                    dominantBaseline="middle"
                    textAnchor="end"
                    x={-8}
                    y={bandY + y.bandwidth() / 2}
                  >
                    {truncate(item.label)}
                  </text>
                  <rect
                    fill={color}
                    fillOpacity={0.82}
                    height={y.bandwidth()}
                    rx={3}
                    width={barWidth}
                    x={0}
                    y={bandY}
                  >
                    <title>{`${item.label}：${item.hint ?? valueLabel(item.value)}`}</title>
                  </rect>
                  <text
                    className="fill-muted-foreground text-[10px]"
                    dominantBaseline="middle"
                    x={barWidth + 6}
                    y={bandY + y.bandwidth() / 2}
                  >
                    {valueLabel(item.value)}
                  </text>
                </g>
              );
            })}
          </g>
        );
      }}
    </ChartCanvas>
  );
}
