import { area, curveMonotoneX, line, max, scaleLinear } from "d3";
import { AxisLabel, YAxis } from "@/components/charts/axis";
import { ChartCanvas } from "@/components/charts/chart-canvas";
import { CHART_COLORS } from "@/lib/chart-colors";
import { formatDecimal, formatInteger } from "@/lib/format";
import type { StreamShape, StreamShapeBucket } from "@/lib/aggregate";

interface StreamShapeChartProps {
  shape: StreamShape;
}

const X_TICKS = [0, 25, 50, 75, 100];

function relativeLabel(value: number | null): string {
  return value == null ? "—" : `×${formatDecimal(value)}`;
}

export function StreamShapeChart({ shape }: StreamShapeChartProps) {
  const buckets = shape.buckets;
  const peakValue = max(buckets, bucket => Math.max(bucket.p75, bucket.relative)) ?? 1.5;

  if (buckets.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <ChartCanvas ariaLabel="所有场次按直播进度对齐后的弹幕活跃度曲线" height={280}>
        {({ width, height }) => {
          const margin = { top: 16, right: 16, bottom: 34, left: 44 };
          const innerWidth = Math.max(0, width - margin.left - margin.right);
          const innerHeight = Math.max(0, height - margin.top - margin.bottom);
          const x = scaleLinear().domain([0, 100]).range([0, innerWidth]);
          const y = scaleLinear()
            .domain([0, Math.max(1.4, peakValue * 1.08)])
            .nice()
            .range([innerHeight, 0]);

          const band = area<StreamShapeBucket>()
            .x(bucket => x(bucket.position * 100))
            .y0(bucket => y(bucket.p25))
            .y1(bucket => y(bucket.p75))
            .curve(curveMonotoneX)(buckets);
          const averageLine = line<StreamShapeBucket>()
            .x(bucket => x(bucket.position * 100))
            .y(bucket => y(bucket.relative))
            .curve(curveMonotoneX)(buckets);

          return (
            <g transform={`translate(${margin.left},${margin.top})`}>
              <YAxis format={value => `×${formatDecimal(value)}`} scale={y} x={innerWidth} />

              <line
                className="stroke-muted-foreground"
                strokeDasharray="4 4"
                strokeOpacity={0.5}
                x1={0}
                x2={innerWidth}
                y1={y(1)}
                y2={y(1)}
              />

              {band ? (
                <path d={band} fill={CHART_COLORS[0]} fillOpacity={0.18} stroke="none" />
              ) : null}
              {averageLine ? (
                <path
                  d={averageLine}
                  fill="none"
                  stroke={CHART_COLORS[0]}
                  strokeLinecap="round"
                  strokeWidth={2}
                />
              ) : null}

              {buckets.map(bucket => (
                <circle
                  cx={x(bucket.position * 100)}
                  cy={y(bucket.relative)}
                  fill={CHART_COLORS[0]}
                  key={bucket.position}
                  r={2.4}
                >
                  <title>
                    {`${Math.round(bucket.position * 100)}% · 相对 ×${formatDecimal(bucket.relative)} · ${formatDecimal(bucket.perMinute)} 条/分 · ${formatInteger(bucket.streams)} 场`}
                  </title>
                </circle>
              ))}

              {X_TICKS.map(tick => (
                <text
                  className="fill-muted-foreground text-[10px]"
                  key={tick}
                  textAnchor="middle"
                  x={x(tick)}
                  y={innerHeight + 14}
                >
                  {tick === 0 ? "开播" : tick === 100 ? "结束" : `${tick}%`}
                </text>
              ))}
              <AxisLabel x={innerWidth / 2} y={innerHeight + 30}>
                直播进度
              </AxisLabel>
            </g>
          );
        }}
      </ChartCanvas>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
        <li>虚线 ×1 = 自身均值</li>
        <li>首段 {relativeLabel(shape.headRelative)}</li>
        <li>中段 {relativeLabel(shape.midRelative)}</li>
        <li>尾段 {relativeLabel(shape.tailRelative)}</li>
        {shape.peak ? (
          <li>
            峰值 {relativeLabel(shape.peak.relative)} @ {Math.round(shape.peak.position * 100)}%
          </li>
        ) : null}
        <li>{formatInteger(shape.streams)} 场参与</li>
      </ul>
    </div>
  );
}
