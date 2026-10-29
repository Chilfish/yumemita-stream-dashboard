import { area, curveMonotoneX, line, max, scaleLinear } from "d3";
import { useId, useState } from "react";
import type { PointerEvent } from "react";
import { AxisLabel, YAxis } from "@/components/charts/axis";
import { ChartCanvas } from "@/components/charts/chart-canvas";
import { minWidthForPoints, resolveMargin } from "@/lib/chart-layout";
import { EmptyChart } from "@/components/charts/chart-card";
import { CHART_COLORS } from "@/lib/chart-colors";
import { formatCompact, formatMinuteOffset } from "@/lib/format";
import type { PeakMinute } from "@/types/datapack";

export interface StreamTimelineProps {
  /** 逐分钟弹幕条数，`chat.density.perMinute`。 */
  minutes: number[];
  /** 逐分钟 SC 笔数，`chat.density.perMinuteSc`；只用于底部刻度轨。 */
  superchats: number[];
  /** 峰值分钟，`chat.density.peakMinute`。 */
  peak: PeakMinute | null;
  ariaLabel: string;
  height?: number;
}

function pointerIndex(
  event: PointerEvent<SVGRectElement>,
  scale: { invert: (value: number) => number },
  length: number,
): number {
  const bounds = event.currentTarget.getBoundingClientRect();
  const index = Math.round(scale.invert(event.clientX - bounds.left));
  return Math.min(Math.max(index, 0), Math.max(0, length - 1));
}

/**
 * 单场双轨时间轴：弹幕面积（主）+ SC 刻度（次）+ 峰值标记，悬停十字线带实时读数。
 * 坐标系由 D3 计算，DOM 由 React 拥有。
 */
export function StreamTimeline({
  minutes,
  superchats,
  peak,
  ariaLabel,
  height = 300,
}: StreamTimelineProps) {
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = `stream-timeline-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  if (minutes.length === 0) {
    return (
      <EmptyChart
        height={height}
        hint="没有可用的逐分钟数据。"
        message="本场没有逐分钟弹幕数据"
      />
    );
  }

  const maxChat = max(minutes) ?? 1;
  const maxSc = max(superchats) ?? 1;
  const hoverValue = hover == null ? null : (minutes[hover] ?? 0);
  const hoverSc = hover == null ? 0 : (superchats[hover] ?? 0);
  const peakMinute =
    peak != null && peak.offsetMin >= 0 && peak.offsetMin < minutes.length ? peak : null;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="min-h-4 text-footnote text-muted-foreground tabular-nums">
        {hoverValue == null ? (
          "悬停或点按查看任意一分钟的读数"
        ) : (
          <>
            第 <span className="font-semibold text-foreground">{hover}</span> 分 ·{" "}
            <span className="font-semibold text-foreground">{formatCompact(hoverValue)}</span> 条 ·{" "}
            <span className="text-paid">SC {hoverSc} 笔</span>
          </>
        )}
      </p>

      <ChartCanvas
        ariaLabel={ariaLabel}
        height={height}
        minWidth={minWidthForPoints(minutes.length, 8)}
      >
        {({ compact, width, height: canvasHeight }) => {
          const margin = resolveMargin({ top: 28, right: 16, bottom: 34, left: 46 }, compact);
          const innerWidth = Math.max(0, width - margin.left - margin.right);
          const innerHeight = Math.max(0, canvasHeight - margin.top - margin.bottom);
          const scTrackHeight = 20;
          const chatHeight = Math.max(48, innerHeight - scTrackHeight - 16);
          const scTop = chatHeight + 16;
          const x = scaleLinear()
            .domain([0, Math.max(1, minutes.length - 1)])
            .range([0, innerWidth]);
          const y = scaleLinear().domain([0, maxChat]).nice().range([chatHeight, 0]);
          const scScale = scaleLinear().domain([0, maxSc]).range([3, scTrackHeight]);
          const tickWidth = Math.max(
            1.5,
            Math.min(4, (innerWidth / Math.max(1, minutes.length)) * 0.6),
          );
          const linePath = line<number>()
            .x((_, index) => x(index))
            .y(value => y(value))
            .curve(curveMonotoneX)(minutes);
          const areaPath = area<number>()
            .x((_, index) => x(index))
            .y0(chatHeight)
            .y1(value => y(value))
            .curve(curveMonotoneX)(minutes);
          const tickStep = minutes.length > 120 ? 30 : minutes.length > 50 ? 15 : 10;
          const xTicks = Array.from(
            { length: Math.floor((minutes.length - 1) / tickStep) + 1 },
            (_, index) => index * tickStep,
          );
          const peakX = peakMinute ? x(peakMinute.offsetMin) : 0;
          const peakY = peakMinute ? Math.max(12, y(Math.max(peakMinute.count, 0)) - 10) : 0;
          const peakLabelOnLeft = peakX > innerWidth * 0.72;
          const trackBottom = scTop + scTrackHeight;

          return (
            <g transform={`translate(${margin.left},${margin.top})`}>
              <defs>
                <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
                </linearGradient>
              </defs>

              {/* 弹幕轨：横向网格 + 面积 + 折线 */}
              <YAxis scale={y} x={innerWidth} />
              <text
                className="fill-ink-3 text-caption font-semibold"
                textAnchor="end"
                x={-8}
                y={8}
              >
                弹幕
              </text>
              {areaPath ? <path className="chart-area" d={areaPath} fill={`url(#${gradientId})`} /> : null}
              {linePath ? (
                <path
                  className="chart-line"
                  d={linePath}
                  fill="none"
                  pathLength={1}
                  stroke={CHART_COLORS[0]}
                  strokeWidth={1.7}
                />
              ) : null}

              {/* SC 轨：逐分钟刻度 */}
              <line className="stroke-border" x1={0} x2={innerWidth} y1={trackBottom} y2={trackBottom} />
              <text
                className="fill-ink-3 text-caption font-semibold"
                textAnchor="end"
                x={-8}
                y={trackBottom - 2}
              >
                SC
              </text>
              {superchats.map((count, index) => {
                if (count <= 0) return null;
                const tickHeight = scScale(count);
                return (
                  <rect
                    fill={CHART_COLORS[3]}
                    height={tickHeight}
                    key={`sc-${index}`}
                    opacity={0.85}
                    rx={1}
                    width={tickWidth}
                    x={x(index) - tickWidth / 2}
                    y={trackBottom - tickHeight}
                  >
                    <title>{`第 ${formatMinuteOffset(index)} · SC ${count} 笔`}</title>
                  </rect>
                );
              })}

              {/* 峰值标记 */}
              {peakMinute ? (
                <g pointerEvents="none">
                  <line
                    className="stroke-foreground/25"
                    strokeDasharray="3 4"
                    x1={peakX}
                    x2={peakX}
                    y1={0}
                    y2={trackBottom}
                  />
                  <path
                    className="fill-foreground"
                    d={`M ${peakX - 4} ${peakY + 6} L ${peakX + 4} ${peakY + 6} L ${peakX} ${peakY} Z`}
                  />
                  <text
                    className="fill-foreground text-caption font-semibold tabular-nums"
                    textAnchor={peakLabelOnLeft ? "end" : "start"}
                    x={peakX + (peakLabelOnLeft ? -8 : 8)}
                    y={-10}
                  >
                    {`峰值 第 ${peakMinute.offsetMin} 分 · ${formatCompact(peakMinute.count)}`}
                  </text>
                </g>
              ) : null}

              {xTicks.map(tick => (
                <AxisLabel key={tick} x={x(tick)} y={trackBottom + 16}>
                  {`${tick} 分`}
                </AxisLabel>
              ))}

              {/* 悬停十字线 */}
              {hover != null && hoverValue != null ? (
                <g pointerEvents="none">
                  <line
                    className="stroke-foreground/25"
                    strokeDasharray="3 3"
                    x1={x(hover)}
                    x2={x(hover)}
                    y1={0}
                    y2={trackBottom}
                  />
                  <circle
                    cx={x(hover)}
                    cy={y(hoverValue)}
                    fill={CHART_COLORS[0]}
                    r={3.5}
                    stroke="var(--background)"
                    strokeWidth={1.5}
                  />
                  {hoverSc > 0 ? (
                    <circle
                      cx={x(hover)}
                      cy={trackBottom - 4}
                      fill={CHART_COLORS[3]}
                      r={2.5}
                      stroke="var(--background)"
                      strokeWidth={1}
                    />
                  ) : null}
                </g>
              ) : null}

              <rect
                fill="transparent"
                height={trackBottom}
                onPointerCancel={() => setHover(null)}
                onPointerDown={event => setHover(pointerIndex(event, x, minutes.length))}
                onPointerLeave={() => setHover(null)}
                onPointerMove={event => setHover(pointerIndex(event, x, minutes.length))}
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
    </div>
  );
}
