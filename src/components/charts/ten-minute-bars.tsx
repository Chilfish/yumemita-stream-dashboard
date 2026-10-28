import { max, scaleBand, scaleLinear } from "d3";
import { ChartCanvas } from "@/components/charts/chart-canvas";
import { CHART_COLORS } from "@/lib/chart-colors";
import { AxisLabel, YAxis } from "@/components/charts/axis";
import type { StreamRow } from "@/lib/aggregate";
import { formatCompact } from "@/lib/format";

interface TenMinuteBarsProps {
  row: StreamRow;
}

export function TenMinuteBars({ row }: TenMinuteBarsProps) {
  const buckets = row.pack.chat.density.perTenMinute;
  const maxMessages = max(buckets, bucket => bucket.messages) ?? 1;

  return (
    <ChartCanvas ariaLabel={`${row.summary.title} 的每十分钟弹幕量`} height={230}>
      {({ width, height }) => {
        const margin = { top: 12, right: 16, bottom: 34, left: 44 };
        const innerWidth = Math.max(0, width - margin.left - margin.right);
        const innerHeight = Math.max(0, height - margin.top - margin.bottom);
        const x = scaleBand()
          .domain(buckets.map(bucket => String(bucket.offsetMin)))
          .range([0, innerWidth])
          .paddingInner(0.2);
        const y = scaleLinear().domain([0, maxMessages]).nice().range([innerHeight, 0]);
        const labelEvery = Math.max(1, Math.ceil(buckets.length / 10));

        return (
          <g transform={`translate(${margin.left},${margin.top})`}>
            <YAxis scale={y} x={innerWidth} />
            {buckets.map((bucket, index) => {
              const bandX = x(String(bucket.offsetMin)) ?? 0;
              const barWidth = x.bandwidth();
              const barHeight = innerHeight - y(bucket.messages);
              return (
                <g key={bucket.offsetMin}>
                  <rect
                    fill={CHART_COLORS[0]}
                    height={barHeight}
                    rx={2}
                    width={barWidth}
                    x={bandX}
                    y={y(bucket.messages)}
                  >
                    <title>{`${bucket.offsetMin}–${bucket.offsetMin + 9} 分：${formatCompact(bucket.messages)} 条`}</title>
                  </rect>
                  {bucket.superchats > 0 ? (
                    <circle
                      cx={bandX + barWidth / 2}
                      cy={y(bucket.messages) - 5}
                      fill={CHART_COLORS[3]}
                      r={2.5}
                    >
                      <title>{`SC ${bucket.superchats} 笔`}</title>
                    </circle>
                  ) : null}
                  {index % labelEvery === 0 ? (
                    <text
                      className="fill-muted-foreground text-[10px]"
                      textAnchor="middle"
                      x={bandX + barWidth / 2}
                      y={innerHeight + 14}
                    >
                      {bucket.offsetMin}m
                    </text>
                  ) : null}
                </g>
              );
            })}
            <AxisLabel anchor="start" x={0} y={innerHeight + 28}>
              红点为 SC 笔数 {">"} 0
            </AxisLabel>
          </g>
        );
      }}
    </ChartCanvas>
  );
}
