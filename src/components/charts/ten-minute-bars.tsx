import { max, scaleBand, scaleLinear } from "d3";
import { ChartCanvas } from "@/components/charts/chart-canvas";
import { minWidthForPoints, resolveMargin } from "@/lib/chart-layout";
import { DirectLabel, TickText, YAxis } from "@/components/charts/axis";
import { CHART_COLORS } from "@/lib/chart-colors";
import type { StreamRow } from "@/lib/aggregate";
import { formatCompact } from "@/lib/format";

interface TenMinuteBarsProps {
  row: StreamRow;
}

function clamp(value: number, min: number, maxValue: number): number {
  return Math.min(Math.max(value, min), Math.max(min, maxValue));
}

export function TenMinuteBars({ row }: TenMinuteBarsProps) {
  const buckets = row.pack.chat.density.perTenMinute;
  const hasData = buckets.some(bucket => bucket.messages > 0);

  if (!hasData) {
    return (
      <p className="py-10 text-center text-footnote text-muted-foreground">
        本场没有抓取到弹幕，无法按时段分段。
      </p>
    );
  }

  const maxMessages = max(buckets, bucket => bucket.messages) ?? 1;
  const peakBucket = buckets.reduce((best, bucket) =>
    bucket.messages > best.messages ? bucket : best,
  );
  const scBucket = buckets.reduce<typeof buckets[number] | null>(
    (best, bucket) => (bucket.superchats > 0 && (!best || bucket.superchats > best.superchats) ? bucket : best),
    null,
  );

  return (
    <ChartCanvas
      ariaLabel={`${row.summary.title} 的每十分钟弹幕量`}
      height={230}
      minWidth={minWidthForPoints(buckets.length, 48, { floor: 420 })}
    >
      {({ compact, width, height }) => {
        const margin = resolveMargin({ top: 22, right: 16, bottom: 30, left: 44 }, compact);
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

              return (
                <g key={bucket.offsetMin}>
                  <rect
                    fill={CHART_COLORS[0]}
                    height={innerHeight - y(bucket.messages)}
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
                      <title>{`${bucket.offsetMin}–${bucket.offsetMin + 9} 分：SC ${bucket.superchats} 笔`}</title>
                    </circle>
                  ) : null}
                  {index % labelEvery === 0 ? (
                    <TickText x={bandX + barWidth / 2} y={innerHeight + 14}>
                      {bucket.offsetMin}m
                    </TickText>
                  ) : null}
                </g>
              );
            })}

            <DirectLabel
              anchor="middle"
              label="峰值"
              value={`${formatCompact(peakBucket.messages)} 条`}
              x={clamp((x(String(peakBucket.offsetMin)) ?? 0) + x.bandwidth() / 2, 32, innerWidth - 32)}
              y={clamp(y(peakBucket.messages) - 14, 10, innerHeight)}
            />

            {scBucket ? (
              <DirectLabel
                label="SC"
                value={`${scBucket.superchats} 笔`}
                x={clamp((x(String(scBucket.offsetMin)) ?? 0) + x.bandwidth() + 6, 0, innerWidth - 56)}
                y={clamp(y(scBucket.messages) - 5, 10, innerHeight)}
              />
            ) : null}
          </g>
        );
      }}
    </ChartCanvas>
  );
}
