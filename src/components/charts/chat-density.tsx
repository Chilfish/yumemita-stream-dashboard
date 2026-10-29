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
import type { StreamRow } from "@/lib/aggregate";
import { formatCompact, formatMinuteOffset } from "@/lib/format";

interface ChatDensityProps {
  row: StreamRow;
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

function clamp(value: number, min: number, maxValue: number): number {
  return Math.min(Math.max(value, min), Math.max(min, maxValue));
}

export function ChatDensity({ row }: ChatDensityProps) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const { perMinute, perMinuteSc, peakMinute } = row.pack.chat.density;
  const hasData = perMinute.some(value => value > 0);

  if (!hasData) {
    return (
      <p className="py-12 text-center text-footnote text-muted-foreground">
        本场没有抓取到逐分钟弹幕，无法画出密度曲线。
      </p>
    );
  }

  const maxChat = max(perMinute) ?? 1;
  const maxSc = max(perMinuteSc) ?? 1;
  const memberColor = CHART_COLORS[0];

  return (
    <ChartCanvas
      ariaLabel={`${row.summary.title} 的逐分钟弹幕密度`}
      height={300}
      minWidth={minWidthForPoints(perMinute.length, 7)}
    >
      {({ compact, width, height }) => {
        const margin = resolveMargin({ top: 22, right: 16, bottom: 42, left: 44 }, compact);
        const readoutWidth = compact ? 96 : 112;
        const innerWidth = Math.max(0, width - margin.left - margin.right);
        const innerHeight = Math.max(0, height - margin.top - margin.bottom);
        const scStripHeight = 22;
        const mainHeight = Math.max(40, innerHeight - scStripHeight - 14);
        const scTop = mainHeight + 14;
        const x = scaleLinear()
          .domain([0, Math.max(1, perMinute.length - 1)])
          .range([0, innerWidth]);
        const y = scaleLinear().domain([0, maxChat]).nice().range([mainHeight, 0]);
        const scScale = scaleLinear().domain([0, maxSc]).range([0, scStripHeight]);
        const linePath = line<number>()
          .x((_, index) => x(index))
          .y(value => y(value))
          .curve(curveMonotoneX)(perMinute);
        const areaPath = area<number>()
          .x((_, index) => x(index))
          .y0(mainHeight)
          .y1(value => y(value))
          .curve(curveMonotoneX)(perMinute);
        const xTicks = Array.from(
          { length: Math.floor(perMinute.length / 15) + 1 },
          (_, index) => index * 15,
        ).filter(tick => tick <= perMinute.length - 1);

        const hoverMinute = hover == null ? null : (perMinute[hover] ?? 0);
        const hoverSc = hover == null ? 0 : (perMinuteSc[hover] ?? 0);

        return (
          <g transform={`translate(${margin.left},${margin.top})`}>
            <defs>
              <AreaGradient color={memberColor} id={gradientId} />
            </defs>

            <YAxis scale={y} x={innerWidth} />

            {areaPath ? (
              <path d={areaPath} fill={`url(#${gradientId})`}>
                <title>{`逐分钟弹幕面积：峰值 ${formatCompact(maxChat)} 条/分`}</title>
              </path>
            ) : null}
            {linePath ? (
              <path
                d={linePath}
                fill="none"
                stroke={memberColor}
                strokeLinejoin="round"
                strokeWidth={CHART_LINE_WIDTH}
              >
                <title>{`逐分钟弹幕：峰值 ${formatCompact(maxChat)} 条/分`}</title>
              </path>
            ) : null}

            {perMinuteSc.map((count, index) => {
              if (count <= 0) return null;
              const barHeight = Math.max(2, scScale(count));
              return (
                <rect
                  fill={CHART_COLORS[3]}
                  height={barHeight}
                  key={`sc-${index}`}
                  opacity={0.8}
                  rx={1}
                  width={Math.max(2, innerWidth / Math.max(1, perMinute.length) - 1)}
                  x={x(index)}
                  y={scTop + scStripHeight - barHeight}
                >
                  <title>{`第 ${formatMinuteOffset(index)} · SC ${count} 笔`}</title>
                </rect>
              );
            })}
            <AxisLabel anchor="end" x={-8} y={scTop + scStripHeight / 2 + 3}>
              SC
            </AxisLabel>

            {peakMinute && peakMinute.count > 0 ? (
              <g>
                <circle
                  cx={x(peakMinute.offsetMin)}
                  cy={y(peakMinute.count)}
                  fill={memberColor}
                  r={3.5}
                  stroke="var(--card)"
                  strokeWidth={1.5}
                >
                  <title>{`峰值：第 ${formatMinuteOffset(peakMinute.offsetMin)}，${peakMinute.count} 条`}</title>
                </circle>
                <DirectLabel
                  anchor={
                    x(peakMinute.offsetMin) > innerWidth * 0.72 ? "end" : "start"
                  }
                  label={formatMinuteOffset(peakMinute.offsetMin)}
                  value={`${formatCompact(peakMinute.count)} 条`}
                  x={x(peakMinute.offsetMin) + (x(peakMinute.offsetMin) > innerWidth * 0.72 ? -8 : 8)}
                  y={clamp(y(peakMinute.count) - 12, 10, mainHeight)}
                />
              </g>
            ) : null}

            {xTicks.map(tick => (
              <TickText key={tick} x={x(tick)} y={innerHeight + 16}>
                {tick} 分
              </TickText>
            ))}
            <AxisLabel x={innerWidth / 2} y={innerHeight + 32}>
              开播后分钟
            </AxisLabel>

            {hover != null && hoverMinute != null ? (
              <g pointerEvents="none">
                <line
                  className="stroke-foreground/25"
                  shapeRendering="crispEdges"
                  strokeWidth={1}
                  x1={x(hover)}
                  x2={x(hover)}
                  y1={0}
                  y2={scTop + scStripHeight}
                />
                <circle
                  cx={x(hover)}
                  cy={y(hoverMinute)}
                  fill={memberColor}
                  r={3.5}
                  stroke="var(--card)"
                  strokeWidth={1.5}
                />
                <ChartReadout
                  rows={[
                    { label: "时间", value: formatMinuteOffset(hover) },
                    { label: "弹幕", value: `${formatCompact(hoverMinute)} 条` },
                    { label: "SC", value: `${hoverSc} 笔` },
                  ]}
                  width={readoutWidth}
                  x={clamp(x(hover) + 12, 0, innerWidth - readoutWidth)}
                  y={0}
                />
              </g>
            ) : null}

            <rect
              fill="transparent"
              height={scTop + scStripHeight}
              onPointerCancel={() => setHover(null)}
              onPointerDown={event => setHover(pointerHoverIndex(event, x, perMinute.length))}
              onPointerLeave={() => setHover(null)}
              onPointerMove={event => setHover(pointerHoverIndex(event, x, perMinute.length))}
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
  );
}
