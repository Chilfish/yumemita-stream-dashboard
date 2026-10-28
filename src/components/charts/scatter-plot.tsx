import { max, scaleLinear, scaleSqrt } from "d3";
import { ChartCanvas } from "@/components/charts/chart-canvas";
import { CHART_COLORS } from "@/lib/chart-colors";
import { AxisLabel, YAxis } from "@/components/charts/axis";
import type { StreamRow } from "@/lib/aggregate";
import { formatCompact, formatDate } from "@/lib/format";

interface ScatterPlotProps {
  rows: StreamRow[];
  selectedId?: string | null;
  onSelect?: (videoId: string) => void;
}

export function ScatterPlot({ rows, selectedId, onSelect }: ScatterPlotProps) {
  const points = rows.filter(
    row =>
      row.pack.vstats?.avgConcurrent != null &&
      row.pack.derived.chatPer1000AvgViewers != null,
  );
  const maxX = max(points, row => row.pack.vstats?.avgConcurrent ?? 0) ?? 1;
  const maxY = max(points, row => row.pack.derived.chatPer1000AvgViewers ?? 0) ?? 1;
  const maxChat = max(points, row => row.pack.chat.total) ?? 1;
  const minChat = Math.min(...points.map(row => row.pack.chat.total), maxChat);

  return (
    <ChartCanvas ariaLabel="平均同接与每千同接弹幕数的散点图" height={320}>
      {({ width, height }) => {
        const margin = { top: 18, right: 20, bottom: 44, left: 56 };
        const innerWidth = Math.max(0, width - margin.left - margin.right);
        const innerHeight = Math.max(0, height - margin.top - margin.bottom);
        const x = scaleLinear().domain([0, maxX * 1.08]).nice().range([0, innerWidth]);
        const y = scaleLinear().domain([0, maxY * 1.12]).nice().range([innerHeight, 0]);
        const radius = scaleSqrt().domain([minChat, maxChat]).range([4, 13]);
        const xTicks = x.ticks(5);

        return (
          <g transform={`translate(${margin.left},${margin.top})`}>
            <YAxis scale={y} x={innerWidth} />
            {xTicks.map(tick => (
              <g key={tick}>
                <line
                  className="stroke-border/60"
                  strokeDasharray="2 4"
                  x1={x(tick)}
                  x2={x(tick)}
                  y1={0}
                  y2={innerHeight}
                />
                <text
                  className="fill-muted-foreground text-[10px]"
                  textAnchor="middle"
                  x={x(tick)}
                  y={innerHeight + 16}
                >
                  {formatCompact(tick)}
                </text>
              </g>
            ))}
            <AxisLabel x={innerWidth / 2} y={innerHeight + 34}>
              平均同接
            </AxisLabel>
            <text
              className="fill-muted-foreground text-[10px]"
              textAnchor="middle"
              transform={`translate(${-42},${innerHeight / 2}) rotate(-90)`}
            >
              每千同接弹幕数
            </text>

            {points.map(row => {
              const avg = row.pack.vstats?.avgConcurrent ?? 0;
              const density = row.pack.derived.chatPer1000AvgViewers ?? 0;
              const memberOnly = row.pack.video.availability === "subscriber_only";
              const selected = selectedId === row.summary.videoId;
              return (
                <g
                  key={row.summary.videoId}
                  onClick={() => onSelect?.(row.summary.videoId)}
                  style={{ cursor: onSelect ? "pointer" : "default" }}
                >
                  <circle
                    cx={x(avg)}
                    cy={y(density)}
                    fill={memberOnly ? CHART_COLORS[3] : CHART_COLORS[0]}
                    fillOpacity={selected ? 0.95 : 0.66}
                    r={radius(row.pack.chat.total)}
                    stroke={selected ? "var(--foreground)" : "transparent"}
                    strokeWidth={selected ? 2 : 0}
                  >
                    <title>{`${formatDate(row.summary.startedAt)} ${row.summary.title}\n平均同接 ${formatCompact(avg)} · 每千同接 ${formatCompact(density)} 条 · 弹幕 ${formatCompact(row.pack.chat.total)}`}</title>
                  </circle>
                </g>
              );
            })}

            <g transform={`translate(0,${innerHeight + 42})`}>
              <circle cx={4} cy={-3} fill={CHART_COLORS[0]} r={4} />
              <AxisLabel anchor="start" x={14} y={0}>
                公开
              </AxisLabel>
              <circle cx={54} cy={-3} fill={CHART_COLORS[3]} r={4} />
              <AxisLabel anchor="start" x={64} y={0}>
                会员限定
              </AxisLabel>
            </g>
          </g>
        );
      }}
    </ChartCanvas>
  );
}
