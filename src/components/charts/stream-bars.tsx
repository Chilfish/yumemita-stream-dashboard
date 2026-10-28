import { max, scaleBand, scaleLinear } from "d3";
import { ChartCanvas } from "@/components/charts/chart-canvas";
import { DirectLabel, TickText, YAxis } from "@/components/charts/axis";
import { CHART_COLORS } from "@/lib/chart-colors";
import type { StreamSummary } from "@/types/dataset";
import { formatCompact, formatDate } from "@/lib/format";

interface StreamBarsProps {
  rows: StreamSummary[];
  selectedId?: string | null;
  onSelect?: (videoId: string) => void;
}

function clamp(value: number, min: number, maxValue: number): number {
  return Math.min(Math.max(value, min), Math.max(min, maxValue));
}

export function StreamBars({ rows, selectedId, onSelect }: StreamBarsProps) {
  const sorted = [...rows]
    .filter(row => row.avgConcurrent != null)
    .sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));

  if (sorted.length === 0) {
    return (
      <p className="py-10 text-center text-footnote text-muted-foreground">
        没有带同接数据的场次，这张图暂时为空。
      </p>
    );
  }

  const maxValue = max(sorted, row => row.maxConcurrent ?? 0) ?? 1;
  const peakRow = sorted.reduce((best, row) =>
    (row.maxConcurrent ?? row.avgConcurrent ?? 0) > (best.maxConcurrent ?? best.avgConcurrent ?? 0)
      ? row
      : best,
  );

  return (
    <ChartCanvas ariaLabel="每场直播的平均与最大同接" height={300}>
      {({ width, height }) => {
        const margin = { top: 30, right: 16, bottom: 32, left: 48 };
        const innerWidth = Math.max(0, width - margin.left - margin.right);
        const innerHeight = Math.max(0, height - margin.top - margin.bottom);
        const x = scaleBand()
          .domain(sorted.map(row => row.videoId))
          .range([0, innerWidth])
          .paddingInner(0.3);
        const y = scaleLinear().domain([0, maxValue]).nice().range([innerHeight, 0]);
        const barWidth = Math.max(2, x.bandwidth() / 2 - 1);
        const labelEvery = Math.max(1, Math.ceil(sorted.length / 6));

        // 直接标注：把两条系列的名字与数值挂在最高的一组柱子上，不再另设图例。
        const peakCenter = (x(peakRow.videoId) ?? 0) + x.bandwidth() / 2;
        const peakTop = Math.min(
          y(peakRow.avgConcurrent ?? 0),
          y(peakRow.maxConcurrent ?? peakRow.avgConcurrent ?? 0),
        );
        const peakAnchor = peakCenter > innerWidth * 0.62 ? "end" : "start";
        const peakLabelX = clamp(
          peakCenter + (peakAnchor === "end" ? -8 : 8),
          56,
          innerWidth - 4,
        );

        return (
          <g transform={`translate(${margin.left},${margin.top})`}>
            <YAxis scale={y} x={innerWidth} />

            {sorted.map((row, index) => {
              const avg = row.avgConcurrent;
              const peak = row.maxConcurrent;
              if (avg == null) return null;
              const bandX = x(row.videoId) ?? 0;
              const center = bandX + x.bandwidth() / 2;
              const dimmed = selectedId != null && selectedId !== row.videoId;

              return (
                <g
                  aria-label={`${formatDate(row.startedAt)} ${row.title}`}
                  key={row.videoId}
                  onClick={() => onSelect?.(row.videoId)}
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
                    <title>{`${formatDate(row.startedAt)} 平均 ${formatCompact(avg)}`}</title>
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
                      <title>{`${formatDate(row.startedAt)} 最大 ${formatCompact(peak)}`}</title>
                    </rect>
                  ) : null}
                  {index % labelEvery === 0 ? (
                    <TickText x={center} y={innerHeight + 14}>
                      {formatDate(row.startedAt)}
                    </TickText>
                  ) : null}
                </g>
              );
            })}

            <DirectLabel
              anchor={peakAnchor}
              label="平均"
              value={formatCompact(peakRow.avgConcurrent)}
              x={peakLabelX}
              y={clamp(peakTop - 16, 10, innerHeight)}
            />
            <DirectLabel
              anchor={peakAnchor}
              label="最大"
              value={formatCompact(peakRow.maxConcurrent)}
              x={peakLabelX}
              y={clamp(peakTop - 1, 10, innerHeight)}
            />
          </g>
        );
      }}
    </ChartCanvas>
  );
}
