import { area, curveMonotoneX, line, max, scaleLinear } from "d3";
import { useState } from "react";
import type { PointerEvent } from "react";
import { ChartCanvas } from "@/components/charts/chart-canvas";
import { CHART_COLORS } from "@/lib/chart-colors";
import { AxisLabel, YAxis } from "@/components/charts/axis";
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

export function ChatDensity({ row }: ChatDensityProps) {
  const [hover, setHover] = useState<number | null>(null);
  const { perMinute, perMinuteSc, peakMinute } = row.pack.chat.density;
  const maxChat = max(perMinute) ?? 1;
  const maxSc = max(perMinuteSc) ?? 1;

  return (
    <ChartCanvas ariaLabel={`${row.summary.title} 的逐分钟弹幕密度`} height={300}>
      {({ width, height }) => {
        const margin = { top: 18, right: 16, bottom: 42, left: 44 };
        const innerWidth = Math.max(0, width - margin.left - margin.right);
        const innerHeight = Math.max(0, height - margin.top - margin.bottom);
        const scStripHeight = 24;
        const mainHeight = Math.max(40, innerHeight - scStripHeight - 12);
        const scTop = mainHeight + 12;
        const x = scaleLinear().domain([0, Math.max(1, perMinute.length - 1)]).range([0, innerWidth]);
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

        const hoverMinute = hover == null ? null : perMinute[hover] ?? 0;
        const hoverSc = hover == null ? 0 : perMinuteSc[hover] ?? 0;

        return (
          <g transform={`translate(${margin.left},${margin.top})`}>
            <YAxis scale={y} x={innerWidth} />
            {areaPath ? (
              <path d={areaPath} fill={CHART_COLORS[0]} opacity={0.16} />
            ) : null}
            {linePath ? (
              <path
                d={linePath}
                fill="none"
                stroke={CHART_COLORS[0]}
                strokeWidth={1.8}
              />
            ) : null}

            {perMinuteSc.map((count, index) => {
              if (count <= 0) return null;
              const barHeight = Math.max(2, scScale(count));
              return (
                <rect
                  fill={CHART_COLORS[3]}
                  height={barHeight}
                  key={`sc-${index}`}
                  opacity={0.75}
                  rx={1}
                  width={Math.max(2, innerWidth / Math.max(1, perMinute.length) - 1)}
                  x={x(index)}
                  y={scTop + scStripHeight - barHeight}
                >
                  <title>{`第 ${formatMinuteOffset(index)} · SC ${count} 笔`}</title>
                </rect>
              );
            })}
            <AxisLabel anchor="start" x={0} y={scTop + scStripHeight + 12}>
              SC 笔数
            </AxisLabel>

            {peakMinute ? (
              <g>
                <circle
                  cx={x(peakMinute.offsetMin)}
                  cy={y(peakMinute.count)}
                  fill={CHART_COLORS[2]}
                  r={3.5}
                  stroke="var(--background)"
                  strokeWidth={1.5}
                />
                <title>{`峰值：第 ${formatMinuteOffset(peakMinute.offsetMin)}，${peakMinute.count} 条`}</title>
              </g>
            ) : null}

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

            {hover != null && hoverMinute != null ? (
              <g pointerEvents="none">
                <line
                  className="stroke-foreground/25"
                  strokeDasharray="3 3"
                  x1={x(hover)}
                  x2={x(hover)}
                  y1={0}
                  y2={scTop + scStripHeight}
                />
                <circle
                  cx={x(hover)}
                  cy={y(hoverMinute)}
                  fill={CHART_COLORS[0]}
                  r={3.5}
                  stroke="var(--background)"
                  strokeWidth={1.5}
                />
                <text
                  className="fill-foreground text-[10px]"
                  textAnchor={x(hover) > innerWidth * 0.7 ? "end" : "start"}
                  x={x(hover) + (x(hover) > innerWidth * 0.7 ? -6 : 6)}
                  y={12}
                >
                  {`第 ${formatMinuteOffset(hover)} · ${formatCompact(hoverMinute)} 条 · SC ${hoverSc}`}
                </text>
              </g>
            ) : null}

            <rect
              fill="transparent"
              height={scTop + scStripHeight}
              onPointerCancel={() => setHover(null)}
              onPointerDown={event => setHover(pointerHoverIndex(event, x, perMinute.length))}
              onPointerLeave={() => setHover(null)}
              onPointerMove={event => setHover(pointerHoverIndex(event, x, perMinute.length))}
              style={{ touchAction: "pan-y" }}
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
