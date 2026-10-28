import type { ReactNode } from "react";
import { useElementWidth } from "@/hooks/use-element-width";

interface ChartCanvasProps {
  height: number;
  ariaLabel: string;
  children: (size: { width: number; height: number }) => ReactNode;
  className?: string;
}

/**
 * 统一处理响应式宽度：外层 div 负责测量，svg 只负责画。
 * 图表内部自行留 margin，避免每个组件重复写 ResizeObserver。
 */
export function ChartCanvas({ height, ariaLabel, children, className }: ChartCanvasProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();

  return (
    <div ref={ref} className={className} style={{ minHeight: height }}>
      {width > 0 ? (
        <svg
          aria-label={ariaLabel}
          height={height}
          role="img"
          viewBox={`0 0 ${width} ${height}`}
          width={width}
        >
          {children({ width, height })}
        </svg>
      ) : null}
    </div>
  );
}
