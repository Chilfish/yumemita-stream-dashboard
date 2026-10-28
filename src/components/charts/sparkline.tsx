import { area as areaShape, curveMonotoneX, line as lineShape, scaleLinear } from "d3";
import { useId } from "react";
import { ChartCanvas } from "@/components/charts/chart-canvas";
import { cn } from "@/lib/utils";

interface SparklineProps {
  values: number[];
  height?: number;
  peakIndex?: number;
  area?: boolean;
  color?: string;
  ariaLabel?: string;
  className?: string;
}

export function Sparkline({
  values,
  height = 82,
  peakIndex,
  area = true,
  color,
  ariaLabel,
  className,
}: SparklineProps) {
  const reactId = useId();

  if (values.length < 2) return null;

  const stroke = color ?? "var(--member-color, var(--chart-1))";
  const gradientId = `sparkline-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const peak =
    peakIndex !== undefined && peakIndex >= 0 && peakIndex < values.length ? peakIndex : undefined;

  return (
    <ChartCanvas
      ariaLabel={ariaLabel ?? "趋势迷你曲线"}
      className={cn("w-full", className)}
      height={height}
    >
      {({ width, height: canvasHeight }) => {
        const pad = 3;
        let low = Math.min(...values);
        let high = Math.max(...values);

        if (low === high) {
          low -= 1;
          high += 1;
        }

        const x = scaleLinear()
          .domain([0, values.length - 1])
          .range([pad, Math.max(pad + 1, width - pad)]);
        const y = scaleLinear()
          .domain([low, high])
          .range([canvasHeight - pad, pad]);

        const curve = lineShape<number>()
          .x((_, index) => x(index))
          .y(value => y(value))
          .curve(curveMonotoneX);
        const band = areaShape<number>()
          .x((_, index) => x(index))
          .y0(canvasHeight - pad)
          .y1(value => y(value))
          .curve(curveMonotoneX);

        const linePath = curve(values);
        const areaPath = band(values);

        return (
          <>
            {area ? (
              <defs>
                <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
            ) : null}

            {area && areaPath ? <path d={areaPath} fill={`url(#${gradientId})`} /> : null}

            {linePath ? (
              <path
                d={linePath}
                fill="none"
                stroke={stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.7}
              />
            ) : null}

            {peak !== undefined ? (
              <circle
                cx={x(peak)}
                cy={y(values[peak])}
                fill={stroke}
                r={2.4}
                stroke="var(--card)"
                strokeWidth={1.5}
              />
            ) : null}
          </>
        );
      }}
    </ChartCanvas>
  );
}
