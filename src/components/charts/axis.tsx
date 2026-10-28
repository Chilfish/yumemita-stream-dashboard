import type { ReactNode } from "react";
import type { ScaleLinear } from "d3";
import { formatCompact } from "@/lib/format";

interface YAxisProps {
  scale: ScaleLinear<number, number>;
  x: number;
  ticks?: number;
  format?: (value: number) => string;
}

/** 横向网格线 + 左侧刻度。调用方把 x 设为绘图区右边界。 */
export function YAxis({ scale, x, ticks = 4, format = formatCompact }: YAxisProps) {
  return (
    <g>
      {scale.ticks(ticks).map(tick => {
        const y = scale(tick);
        return (
          <g key={tick}>
            <line
              className="stroke-border"
              strokeDasharray="3 4"
              x1={0}
              x2={x}
              y1={y}
              y2={y}
            />
            <text
              className="fill-muted-foreground text-[10px]"
              dominantBaseline="middle"
              textAnchor="end"
              x={-8}
              y={y}
            >
              {format(tick)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

interface AxisLabelProps {
  x: number;
  y: number;
  children: ReactNode;
  anchor?: "start" | "middle" | "end";
}

export function AxisLabel({ x, y, children, anchor = "middle" }: AxisLabelProps) {
  return (
    <text
      className="fill-muted-foreground text-[10px]"
      textAnchor={anchor}
      x={x}
      y={y}
    >
      {children}
    </text>
  );
}
