import { max, scaleLinear, scaleSqrt } from "d3";
import { ChartCanvas } from "@/components/charts/chart-canvas";
import { AxisLabel, DirectLabel, TickText, YAxis } from "@/components/charts/axis";
import { CHART_COLORS } from "@/lib/chart-colors";
import type { StreamSummary } from "@/types/dataset";
import { formatCompact, formatDate } from "@/lib/format";

interface ScatterPlotProps {
  rows: StreamSummary[];
  selectedId?: string | null;
  onSelect?: (videoId: string) => void;
}

function clamp(value: number, min: number, maxValue: number): number {
  return Math.min(Math.max(value, min), Math.max(min, maxValue));
}

/** 会员限定用空心圈表示，不靠颜色单独承载状态，因此不需要图例。 */
export function ScatterPlot({ rows, selectedId, onSelect }: ScatterPlotProps) {
  const points = rows.filter(
    row => row.avgConcurrent != null && row.chatPer1000AvgViewers != null,
  );

  if (points.length === 0) {
    return (
      <p className="py-10 text-center text-footnote text-muted-foreground">
        没有同时具备同接与弹幕浓度的场次，这张图暂时为空。
      </p>
    );
  }

  const maxX = max(points, row => row.avgConcurrent ?? 0) ?? 1;
  const maxY = max(points, row => row.chatPer1000AvgViewers ?? 0) ?? 1;
  const maxChat = max(points, row => row.chatTotal) ?? 1;
  const minChat = Math.min(...points.map(row => row.chatTotal), maxChat);
  const radiusScale =
    maxChat > minChat
      ? scaleSqrt().domain([minChat, maxChat]).range([4, 13])
      : () => 7;
  const selectedPoint = points.find(row => row.videoId === selectedId) ?? null;
  const memberOnlyPeak =
    points
      .filter(row => row.availability === "subscriber_only")
      .reduce<StreamSummary | null>(
        (best, row) => (best === null || row.chatTotal > best.chatTotal ? row : best),
        null,
      );

  return (
    <ChartCanvas ariaLabel="平均同接与每千同接弹幕数的散点图" height={320}>
      {({ width, height }) => {
        const margin = { top: 18, right: 20, bottom: 44, left: 56 };
        const innerWidth = Math.max(0, width - margin.left - margin.right);
        const innerHeight = Math.max(0, height - margin.top - margin.bottom);
        const x = scaleLinear().domain([0, maxX * 1.08]).nice().range([0, innerWidth]);
        const y = scaleLinear().domain([0, maxY * 1.12]).nice().range([innerHeight, 0]);
        const xTicks = x.ticks(5);

        return (
          <g transform={`translate(${margin.left},${margin.top})`}>
            <YAxis scale={y} x={innerWidth} />

            {xTicks.map(tick => (
              <TickText key={tick} x={x(tick)} y={innerHeight + 16}>
                {formatCompact(tick)}
              </TickText>
            ))}
            <AxisLabel x={innerWidth / 2} y={innerHeight + 32}>
              平均同接
            </AxisLabel>
            <AxisLabel vertical x={-42} y={innerHeight / 2}>
              每千同接弹幕数
            </AxisLabel>

            {points.map(row => {
              const avg = row.avgConcurrent ?? 0;
              const density = row.chatPer1000AvgViewers ?? 0;
              const memberOnly = row.availability === "subscriber_only";
              const selected = selectedId === row.videoId;
              const radius = radiusScale(row.chatTotal);

              return (
                <g
                  key={row.videoId}
                  onClick={() => onSelect?.(row.videoId)}
                  style={{ cursor: onSelect ? "pointer" : "default" }}
                >
                  <circle
                    cx={x(avg)}
                    cy={y(density)}
                    fill={memberOnly ? "none" : CHART_COLORS[0]}
                    fillOpacity={selected ? 0.95 : 0.64}
                    r={radius}
                    stroke={memberOnly ? CHART_COLORS[1] : selected ? "var(--foreground)" : "transparent"}
                    strokeWidth={memberOnly ? 1.4 : selected ? 2 : 0}
                  >
                    <title>{`${formatDate(row.startedAt)} ${row.title}${memberOnly ? "（会员限定）" : ""}\n平均同接 ${formatCompact(avg)} · 每千同接 ${formatCompact(density)} 条 · 弹幕 ${formatCompact(row.chatTotal)}`}</title>
                  </circle>
                </g>
              );
            })}

            {memberOnlyPeak ? (
              <DirectLabel
                label="会员限定"
                value={formatDate(memberOnlyPeak.startedAt)}
                x={clamp(
                  x(memberOnlyPeak.avgConcurrent ?? 0) + radiusScale(memberOnlyPeak.chatTotal) + 6,
                  0,
                  innerWidth - 76,
                )}
                y={clamp(y(memberOnlyPeak.chatPer1000AvgViewers ?? 0) - 10, 8, innerHeight)}
              />
            ) : null}

            {selectedPoint ? (
              <DirectLabel
                label={formatDate(selectedPoint.startedAt)}
                value={formatCompact(selectedPoint.avgConcurrent)}
                x={clamp(
                  x(selectedPoint.avgConcurrent ?? 0) + radiusScale(selectedPoint.chatTotal) + 6,
                  0,
                  innerWidth - 76,
                )}
                y={clamp(y(selectedPoint.chatPer1000AvgViewers ?? 0) + 14, 8, innerHeight)}
              />
            ) : null}
          </g>
        );
      }}
    </ChartCanvas>
  );
}
