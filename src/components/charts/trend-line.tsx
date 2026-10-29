import { area, curveMonotoneX, line, max, scaleLinear } from "d3";
import { useId } from "react";
import { AreaGradient, TickText, YAxis } from "@/components/charts/axis";
import { ChartCanvas } from "@/components/charts/chart-canvas";
import { minWidthForPoints, resolveMargin } from "@/lib/chart-layout";
import { EmptyChart } from "@/components/charts/chart-card";
import { CHART_COLORS } from "@/lib/chart-colors";
import { formatCompact } from "@/lib/format";

export interface TrendPoint {
  label: string;
  value: number | null;
  hint?: string;
}

interface TrendLineProps {
  points: TrendPoint[];
  ariaLabel: string;
  height?: number;
  unit?: string;
  color?: string;
  valueFormat?: (value: number) => string;
}

export function TrendLine({
  points,
  ariaLabel,
  height = 260,
  unit,
  color = CHART_COLORS[0],
  valueFormat = formatCompact,
}: TrendLineProps) {
  const gradientId = `trend-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const numeric = points
    .map(point => point.value)
    .filter((value): value is number => value != null && Number.isFinite(value));

  if (numeric.length === 0) {
    return (
      <EmptyChart
        height={height}
        hint="检查 manifest 的 startedAt 是否完整。"
        message="没有可用的月度数据"
      />
    );
  }

  const maxValue = Math.max(1, max(numeric) ?? 1);

  return (
    <ChartCanvas
      ariaLabel={ariaLabel}
      height={height}
      minWidth={minWidthForPoints(points.length, 22)}
    >
      {({ compact, width, height: canvasHeight }) => {
        const margin = resolveMargin({ top: 16, right: 20, bottom: 30, left: 46 }, compact);
        const innerWidth = Math.max(0, width - margin.left - margin.right);
        const innerHeight = Math.max(0, canvasHeight - margin.top - margin.bottom);
        const x = (index: number) =>
          points.length <= 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth;
        const y = scaleLinear().domain([0, maxValue]).nice().range([innerHeight, 0]);
        const values = points.map(point => point.value);

        const linePath = line<number | null>()
          .defined(value => value != null)
          .x((_, index) => x(index))
          .y(value => y(value ?? 0))
          .curve(curveMonotoneX)(values);
        const areaPath = area<number | null>()
          .defined(value => value != null)
          .x((_, index) => x(index))
          .y0(innerHeight)
          .y1(value => y(value ?? 0))
          .curve(curveMonotoneX)(values);

        // 刻度数量跟着绘图区宽度走，并在首尾之间均匀取点：窄屏少放几个月，标签不叠字。
        const lastIndex = points.length - 1;
        const labelCount = Math.min(points.length, Math.max(2, Math.floor(innerWidth / 64)));
        const tickIndices = [
          ...new Set(
            Array.from({ length: labelCount }, (_, step) =>
              Math.round((step / Math.max(1, labelCount - 1)) * lastIndex),
            ),
          ),
        ];

        return (
          <g transform={`translate(${margin.left},${margin.top})`}>
            <defs>
              <AreaGradient color={color} id={gradientId} />
            </defs>

            <YAxis scale={y} x={innerWidth} />

            {areaPath ? <path d={areaPath} fill={`url(#${gradientId})`} /> : null}
            {linePath ? (
              <path
                d={linePath}
                fill="none"
                stroke={color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.7}
              />
            ) : null}

            {points.map((point, index) =>
              point.value == null ? null : (
                <circle
                  cx={x(index)}
                  cy={y(point.value)}
                  fill={color}
                  key={`${point.label}-${index}`}
                  r={2.6}
                  stroke="var(--card)"
                  strokeWidth={1.2}
                >
                  <title>
                    {point.hint ??
                      `${point.label}：${valueFormat(point.value)}${unit ? ` ${unit}` : ""}`}
                  </title>
                </circle>
              ),
            )}

            {tickIndices.map(index => (
              <TickText
                anchor={index === 0 ? "start" : index === lastIndex ? "end" : "middle"}
                key={index}
                x={x(index)}
                y={innerHeight + 18}
              >
                {points[index]?.label}
              </TickText>
            ))}
          </g>
        );
      }}
    </ChartCanvas>
  );
}
