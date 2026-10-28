import { curveMonotoneX, line, max, scaleLinear } from "d3";
import { ChartCanvas } from "@/components/charts/chart-canvas";
import { CHART_COLORS } from "@/lib/chart-colors";
import { AxisLabel, YAxis } from "@/components/charts/axis";
import { formatCompact } from "@/lib/format";

export interface ChartSeries {
  id: string;
  label: string;
  values: number[];
  color?: string;
}

interface MultiLineChartProps {
  series: ChartSeries[];
  ariaLabel: string;
  xLabel?: string;
}

export function MultiLineChart({ series, ariaLabel, xLabel = "开播后分钟" }: MultiLineChartProps) {
  const maxMinutes = max(series, item => item.values.length - 1) ?? 1;
  const maxValue = max(series.flatMap(item => item.values)) ?? 1;

  return (
    <div className="flex flex-col gap-3">
      <ChartCanvas ariaLabel={ariaLabel} height={300}>
        {({ width, height }) => {
          const margin = { top: 16, right: 16, bottom: 38, left: 44 };
          const innerWidth = Math.max(0, width - margin.left - margin.right);
          const innerHeight = Math.max(0, height - margin.top - margin.bottom);
          const x = scaleLinear().domain([0, Math.max(1, maxMinutes)]).range([0, innerWidth]);
          const y = scaleLinear().domain([0, maxValue]).nice().range([innerHeight, 0]);
          const xTicks = Array.from(
            { length: Math.floor(maxMinutes / 30) + 1 },
            (_, index) => index * 30,
          );

          return (
            <g transform={`translate(${margin.left},${margin.top})`}>
              <YAxis scale={y} x={innerWidth} />
              {series.map((item, index) => {
                const path = line<number>()
                  .x((_, minute) => x(minute))
                  .y(value => y(value))
                  .curve(curveMonotoneX)(item.values);
                return path ? (
                  <path
                    d={path}
                    fill="none"
                    key={item.id}
                    stroke={item.color ?? CHART_COLORS[index % CHART_COLORS.length]}
                    strokeWidth={1.8}
                  >
                    <title>{item.label}</title>
                  </path>
                ) : null;
              })}
              {xTicks.map(tick => (
                <text
                  className="fill-muted-foreground text-[10px]"
                  key={tick}
                  textAnchor="middle"
                  x={x(tick)}
                  y={innerHeight + 14}
                >
                  {tick} 分
                </text>
              ))}
              <AxisLabel x={innerWidth / 2} y={innerHeight + 30}>
                {xLabel}
              </AxisLabel>
              <text
                className="fill-muted-foreground text-[10px]"
                textAnchor="middle"
                transform={`translate(${-32},${innerHeight / 2}) rotate(-90)`}
              >
                每分钟弹幕
              </text>
              <text
                className="fill-muted-foreground text-[10px]"
                textAnchor="end"
                x={innerWidth}
                y={-4}
              >
                峰值 {formatCompact(maxValue)} 条/分
              </text>
            </g>
          );
        }}
      </ChartCanvas>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {series.map((item, index) => (
          <li className="flex items-center gap-1.5 text-xs" key={item.id}>
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ backgroundColor: item.color ?? CHART_COLORS[index % CHART_COLORS.length] }}
            />
            <span className="max-w-56 truncate">{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
