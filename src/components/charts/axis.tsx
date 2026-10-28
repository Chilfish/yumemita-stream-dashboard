import type { ReactNode } from "react";
import type { ScaleLinear } from "d3";
import { formatCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

/** 曲线线宽：所有图表共用，避免各画各的。 */
export const CHART_LINE_WIDTH = 1.7;

/** 刻度、单位、口径备注统一用 caption 字阶 + ink-3。 */
const TICK_CLASS = "fill-ink-3 text-caption";

interface YAxisProps {
  scale: ScaleLinear<number, number>;
  x: number;
  ticks?: number;
  format?: (value: number) => string;
}

/**
 * 横向网格线 + 左侧刻度。调用方把 `x` 设为绘图区右边界。
 * 每个图表只保留一个方向的网格：横向由 YAxis 负责，纵向网格不再单独绘制。
 */
export function YAxis({ scale, x, ticks = 4, format = formatCompact }: YAxisProps) {
  return (
    <g>
      {scale.ticks(ticks).map(tick => {
        const y = scale(tick);
        return (
          <g key={tick}>
            <line
              className="stroke-hairline"
              shapeRendering="crispEdges"
              strokeWidth={1}
              x1={0}
              x2={x}
              y1={Math.round(y) + 0.5}
              y2={Math.round(y) + 0.5}
            />
            <text className={TICK_CLASS} dominantBaseline="middle" textAnchor="end" x={-8} y={y}>
              {format(tick)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

interface TickTextProps {
  x: number;
  y: number;
  children: ReactNode;
  anchor?: "start" | "middle" | "end";
  className?: string;
}

/** 刻度文字。与 AxisLabel 的区别：这个是坐标刻度，AxisLabel 是轴标题。 */
export function TickText({ x, y, children, anchor = "middle", className }: TickTextProps) {
  return (
    <text className={cn(TICK_CLASS, className)} textAnchor={anchor} x={x} y={y}>
      {children}
    </text>
  );
}

interface AxisLabelProps {
  x: number;
  y: number;
  children: ReactNode;
  anchor?: "start" | "middle" | "end";
  vertical?: boolean;
}

/** 轴标题：比刻度再降一级颜色，旋转时用 `vertical`。 */
export function AxisLabel({ x, y, children, anchor = "middle", vertical }: AxisLabelProps) {
  return (
    <text
      className="fill-muted-foreground text-caption"
      textAnchor={anchor}
      transform={vertical ? `translate(${x},${y}) rotate(-90)` : undefined}
      x={vertical ? 0 : x}
      y={vertical ? 0 : y}
    >
      {children}
    </text>
  );
}

interface DirectLabelProps {
  x: number;
  y: number;
  label: string;
  value: string;
  anchor?: "start" | "middle" | "end";
}

/** 直接标注：系列名用 ink-3，数值 600 + tabular-nums，替代图例。 */
export function DirectLabel({ x, y, label, value, anchor = "start" }: DirectLabelProps) {
  return (
    <text className="text-footnote" dominantBaseline="middle" textAnchor={anchor} x={x} y={y}>
      <tspan className="fill-ink-3">{label}</tspan>
      <tspan className="fill-foreground font-semibold tabular-nums" dx={4}>
        {value}
      </tspan>
    </text>
  );
}

export interface ReadoutRow {
  label: string;
  value: string;
  color?: string;
}

interface ChartReadoutProps {
  x: number;
  y: number;
  rows: ReadoutRow[];
  width?: number;
}

const READOUT_ROW_HEIGHT = 18;
const READOUT_PADDING_X = 8;
const READOUT_PADDING_Y = 6;

/** 悬停读数：footnote 字阶，数值 600 + tabular-nums。 */
export function ChartReadout({ x, y, rows, width = 124 }: ChartReadoutProps) {
  const height = rows.length * READOUT_ROW_HEIGHT + READOUT_PADDING_Y * 2;

  return (
    <g pointerEvents="none">
      <rect
        className="fill-card stroke-hairline"
        height={height}
        rx={6}
        strokeWidth={1}
        width={width}
        x={x}
        y={y}
      />
      {rows.map((row, index) => {
        const centerY = y + READOUT_PADDING_Y + index * READOUT_ROW_HEIGHT + READOUT_ROW_HEIGHT / 2;
        const indent = row.color ? 10 : 0;

        return (
          <g key={`${row.label}-${index}`}>
            {row.color ? (
              <circle cx={x + READOUT_PADDING_X + 2} cy={centerY} fill={row.color} r={2.5} />
            ) : null}
            <text
              className="text-footnote"
              dominantBaseline="middle"
              x={x + READOUT_PADDING_X + indent}
              y={centerY}
            >
              <tspan className="fill-ink-3">{row.label}</tspan>
              <tspan className="fill-foreground font-semibold tabular-nums" dx={6}>
                {row.value}
              </tspan>
            </text>
          </g>
        );
      })}
    </g>
  );
}

interface AreaGradientProps {
  id: string;
  color: string;
}

/** 面积渐变：22% 透明度到 0，放在 <defs> 里。 */
export function AreaGradient({ id, color }: AreaGradientProps) {
  return (
    <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={0.22} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  );
}
