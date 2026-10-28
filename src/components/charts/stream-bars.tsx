import { max, scaleBand, scaleLinear } from "d3";
import { ChartCanvas } from "@/components/charts/chart-canvas";
import { CHART_COLORS } from "@/lib/chart-colors";
import { AxisLabel, YAxis } from "@/components/charts/axis";
import type { StreamRow } from "@/lib/aggregate";
import { formatCompact, formatDate } from "@/lib/format";

interface StreamBarsProps {
  rows: StreamRow[];
  selectedId?: string | null;
  onSelect?: (videoId: string) => void;
}

export function StreamBars({ rows, selectedId, onSelect }: StreamBarsProps) {
  const sorted = [...rows]
    .filter(row => row.pack.vstats?.avgConcurrent != null)
    .sort((a, b) =>
      (a.summary.startedAt ?? "").localeCompare(b.summary.startedAt ?? ""),
    );
  const maxValue = max(sorted, row => row.pack.vstats?.maxConcurrent ?? 0) ?? 1;

  return (
    <ChartCanvas ariaLabel="每场直播的平均与最大同接" height={300}>
      {({ width, height }) => {
        const margin = { top: 16, right: 16, bottom: 58, left: 48 };
        const innerWidth = Math.max(0, width - margin.left - margin.right);
        const innerHeight = Math.max(0, height - margin.top - margin.bottom);
        const x = scaleBand()
          .domain(sorted.map(row => row.summary.videoId))
          .range([0, innerWidth])
          .paddingInner(0.3);
        const y = scaleLinear().domain([0, maxValue]).nice().range([innerHeight, 0]);
        const barWidth = Math.max(3, x.bandwidth() / 2 - 1);
        const labelEvery = Math.max(1, Math.ceil(sorted.length / 6));

        return (
          <g transform={`translate(${margin.left},${margin.top})`}>
            <YAxis scale={y} x={innerWidth} />
            {sorted.map((row, index) => {
              const avg = row.pack.vstats?.avgConcurrent;
              const peak = row.pack.vstats?.maxConcurrent;
              if (avg == null) return null;
              const bandX = x(row.summary.videoId) ?? 0;
              const center = bandX + x.bandwidth() / 2;
              const dimmed = selectedId != null && selectedId !== row.summary.videoId;
              return (
                <g
                  aria-label={`${formatDate(row.summary.startedAt)} ${row.summary.title}`}
                  key={row.summary.videoId}
                  onClick={() => onSelect?.(row.summary.videoId)}
                  opacity={dimmed ? 0.35 : 1}
                  role={onSelect ? "button" : undefined}
                  style={{ cursor: onSelect ? "pointer" : "default" }}
                >
                  <rect
                    fill={CHART_COLORS[0]}
                    height={innerHeight - y(avg)}
                    rx={2}
                    width={barWidth}
                    x={center - barWidth - 1}
                    y={y(avg)}
                  >
                    <title>{`${formatDate(row.summary.startedAt)} 平均 ${formatCompact(avg)}`}</title>
                  </rect>
                  {peak != null ? (
                    <rect
                      fill={CHART_COLORS[1]}
                      height={innerHeight - y(peak)}
                      rx={2}
                      width={barWidth}
                      x={center + 1}
                      y={y(peak)}
                    >
                      <title>{`${formatDate(row.summary.startedAt)} 最大 ${formatCompact(peak)}`}</title>
                    </rect>
                  ) : null}
                  {index % labelEvery === 0 ? (
                    <text
                      className="fill-muted-foreground text-[10px]"
                      textAnchor="middle"
                      x={center}
                      y={innerHeight + 16}
                    >
                      {formatDate(row.summary.startedAt)}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <g transform={`translate(0,${innerHeight + 44})`}>
              <rect fill={CHART_COLORS[0]} height={8} rx={2} width={8} x={0} y={0} />
              <AxisLabel anchor="start" x={14} y={8}>
                平均同接
              </AxisLabel>
              <rect fill={CHART_COLORS[1]} height={8} rx={2} width={8} x={78} y={0} />
              <AxisLabel anchor="start" x={92} y={8}>
                最大同接
              </AxisLabel>
            </g>
          </g>
        );
      }}
    </ChartCanvas>
  );
}
