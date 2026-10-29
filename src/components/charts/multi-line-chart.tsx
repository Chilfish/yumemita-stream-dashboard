import { area, curveMonotoneX, line, max, scaleLinear } from "d3";
import { useId, useState } from "react";
import type { PointerEvent } from "react";
import { ChartCanvas } from "@/components/charts/chart-canvas";
import { minWidthForPoints, resolveMargin } from "@/lib/chart-layout";
import {
  AreaGradient,
  AxisLabel,
  CHART_LINE_WIDTH,
  ChartReadout,
  DirectLabel,
  TickText,
  YAxis,
} from "@/components/charts/axis";
import { CHART_COLORS } from "@/lib/chart-colors";
import { formatCompact, formatMinuteOffset } from "@/lib/format";

export interface ChartSeries {
  id: string;
  label: string;
  values: number[];
  color?: string;
  /** 直接标注用的短名（例如日期）；缺省回落到 label。 */
  shortLabel?: string;
}

interface MultiLineChartProps {
  series: ChartSeries[];
  ariaLabel: string;
  xLabel?: string;
}

/** ≤2 条线直接标注、≤2 条线铺面积；更多系列只画线并保留图例。 */
const DIRECT_LABEL_LIMIT = 2;
const AREA_LIMIT = 2;

interface EndLabel {
  item: ChartSeries;
  color: string;
  index: number;
  value: number;
  y: number;
}

function clamp(value: number, min: number, maxValue: number): number {
  return Math.min(Math.max(value, min), Math.max(min, maxValue));
}

function pointerHoverIndex(
  event: PointerEvent<SVGRectElement>,
  scale: { invert: (value: number) => number },
  length: number,
): number {
  const bounds = event.currentTarget.getBoundingClientRect();
  const index = Math.round(scale.invert(event.clientX - bounds.left));
  return Math.min(Math.max(index, 0), Math.max(0, length - 1));
}

function seriesColor(item: ChartSeries, index: number): string {
  return item.color ?? CHART_COLORS[index % CHART_COLORS.length];
}

/** 线尾位置：最后一个非零分钟，避免把标签挂在数据结束后的空段。 */
function lastIndex(item: ChartSeries): number {
  for (let index = item.values.length - 1; index >= 0; index -= 1) {
    if (item.values[index] > 0) return index;
  }
  return Math.max(0, item.values.length - 1);
}

export function MultiLineChart({ series, ariaLabel, xLabel = "开播后分钟" }: MultiLineChartProps) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const visible = series.filter(item => item.values.some(value => value > 0));
  const maxMinutes = max(visible, item => item.values.length - 1) ?? 1;
  const maxValue = max(visible.flatMap(item => item.values)) ?? 1;
  const direct = visible.length > 0 && visible.length <= DIRECT_LABEL_LIMIT;

  if (visible.length === 0) {
    return (
      <p className="py-12 text-center text-footnote text-muted-foreground">
        所选场次没有逐分钟弹幕数据，换一批场次再试。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ChartCanvas
        ariaLabel={ariaLabel}
        height={300}
        minWidth={minWidthForPoints(maxMinutes + 1, 7)}
      >
      {({ compact, width, height }) => {
        const margin = resolveMargin(
          { top: 20, right: direct ? 92 : 20, bottom: 40, left: 44 },
          compact,
        );
        const readoutWidth = compact ? 108 : 132;
        const innerWidth = Math.max(0, width - margin.left - margin.right);
        const innerHeight = Math.max(0, height - margin.top - margin.bottom);
        const x = scaleLinear().domain([0, Math.max(1, maxMinutes)]).range([0, innerWidth]);
        const y = scaleLinear().domain([0, maxValue]).nice().range([innerHeight, 0]);
        const xTicks = Array.from(
          { length: Math.floor(maxMinutes / 30) + 1 },
          (_, index) => index * 30,
        ).filter(tick => tick <= maxMinutes);

        // 直接标注沿 y 排序后逐条下压，保证最小行距，避免两条线尾标注重叠。
        const endLabels: EndLabel[] = direct
          ? visible
              .map(item => {
                const index = lastIndex(item);
                const value = item.values[index] ?? 0;
                return {
                  color: seriesColor(item, series.indexOf(item)),
                  index,
                  item,
                  value,
                  y: y(value),
                };
              })
              .sort((left, right) => left.y - right.y)
              .reduce<EndLabel[]>((accumulator, entry) => {
                const previous = accumulator.at(-1);
                accumulator.push({ ...entry, y: Math.max(entry.y, (previous?.y ?? 0) + 18, 8) });
                return accumulator;
              }, [])
          : [];

        const hovered =
          hover == null
            ? []
            : visible
                .filter(item => hover < item.values.length)
                .map(item => ({ item, value: item.values[hover] ?? 0 }));

        return (
          <g transform={`translate(${margin.left},${margin.top})`}>
            <defs>
              {visible.slice(0, AREA_LIMIT).map((item, index) => (
                <AreaGradient
                  color={seriesColor(item, series.indexOf(item))}
                  id={`${gradientId}-${index}`}
                  key={item.id}
                />
              ))}
            </defs>

            <YAxis scale={y} x={innerWidth} />

            {visible.map((item, index) => {
              const color = seriesColor(item, series.indexOf(item));
              const peak = max(item.values) ?? 0;
              const areaPath =
                visible.length <= AREA_LIMIT
                  ? area<number>()
                      .x((_, minute) => x(minute))
                      .y0(innerHeight)
                      .y1(value => y(value))
                      .curve(curveMonotoneX)(item.values)
                  : null;
              const linePath = line<number>()
                .x((_, minute) => x(minute))
                .y(value => y(value))
                .curve(curveMonotoneX)(item.values);

              return (
                <g key={item.id}>
                  {areaPath ? (
                    <path className="chart-area" d={areaPath} fill={`url(#${gradientId}-${index})`}>
                      <title>{`${item.label}：逐分钟弹幕面积`}</title>
                    </path>
                  ) : null}
                  {linePath ? (
                    <path
                      className="chart-line"
                      d={linePath}
                      fill="none"
                      pathLength={1}
                      stroke={color}
                      strokeLinejoin="round"
                      strokeWidth={CHART_LINE_WIDTH}
                    >
                      <title>{`${item.label}：峰值 ${formatCompact(peak)} 条/分`}</title>
                    </path>
                  ) : null}
                </g>
              );
            })}

            {xTicks.map(tick => (
              <TickText key={tick} x={x(tick)} y={innerHeight + 16}>
                {tick} 分
              </TickText>
            ))}
            <AxisLabel x={innerWidth / 2} y={innerHeight + 32}>
              {xLabel}
            </AxisLabel>

            {endLabels.map(entry => (
              <g key={entry.item.id}>
                <circle
                  cx={x(entry.index)}
                  cy={y(entry.value)}
                  fill={entry.color}
                  r={3}
                  stroke="var(--card)"
                  strokeWidth={1.5}
                />
                <DirectLabel
                  label={entry.item.shortLabel ?? entry.item.label}
                  value={`${formatCompact(entry.value)} 条`}
                  x={x(entry.index) + 8}
                  y={entry.y}
                />
              </g>
            ))}

            {hover != null && hovered.length > 0 ? (
              <g pointerEvents="none">
                <line
                  className="stroke-foreground/25"
                  shapeRendering="crispEdges"
                  strokeWidth={1}
                  x1={x(hover)}
                  x2={x(hover)}
                  y1={0}
                  y2={innerHeight}
                />
                {hovered.map(({ item, value }) => (
                  <circle
                    cx={x(hover)}
                    cy={y(value)}
                    fill={seriesColor(item, series.indexOf(item))}
                    key={item.id}
                    r={3.5}
                    stroke="var(--card)"
                    strokeWidth={1.5}
                  />
                ))}
                <ChartReadout
                  rows={[
                    { label: "时间", value: formatMinuteOffset(hover) },
                    ...hovered.map(({ item, value }) => ({
                      color: seriesColor(item, series.indexOf(item)),
                      label: item.shortLabel ?? item.label,
                      value: formatCompact(value),
                    })),
                  ]}
                  width={readoutWidth}
                  x={clamp(x(hover) + 12, 0, innerWidth - readoutWidth)}
                  y={0}
                />
              </g>
            ) : null}

            <rect
              fill="transparent"
              height={innerHeight}
              onPointerCancel={() => setHover(null)}
              onPointerDown={event => setHover(pointerHoverIndex(event, x, maxMinutes + 1))}
              onPointerLeave={() => setHover(null)}
              onPointerMove={event => setHover(pointerHoverIndex(event, x, maxMinutes + 1))}
              // 窄屏图表可横向滚动：让浏览器接管双指/横滑，点按仍能出读数。
              style={{ touchAction: "pan-x pan-y" }}
              width={innerWidth}
              x={0}
              y={0}
            />
          </g>
        );
      }}
      </ChartCanvas>
      {visible.length > DIRECT_LABEL_LIMIT ? <MultiLineLegend series={visible} /> : null}
    </div>
  );
}

/** >2 个系列时补充图例（直接标注放不下）。 */
export function MultiLineLegend({ series }: { series: ChartSeries[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {series.map((item, index) => (
        <li className="flex min-w-0 items-center gap-1.5 text-footnote" key={item.id}>
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: seriesColor(item, index) }}
          />
          <span className="max-w-56 truncate text-ink-3">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
