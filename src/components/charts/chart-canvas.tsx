import type { ReactNode } from "react";
import { COMPACT_MEDIA_QUERY } from "@/lib/chart-layout";
import { useElementWidth } from "@/hooks/use-element-width";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

/** 右缘淡出：提示这张图还能往右滑，同时不挡住数据。 */
const SCROLL_FADE = "linear-gradient(to right, #000 calc(100% - 2.5rem), rgb(0 0 0 / 0))";

export interface ChartSize {
  width: number;
  height: number;
  /** 窄屏（手机）时为 true，图表内部据此收紧留白与标注。 */
  compact: boolean;
}

interface ChartCanvasProps {
  height: number;
  /**
   * 窄屏最小绘图宽度。图表数据点较多时给出，
   * 容器比它窄就横向滚动，而不是把 36 个月压进 360px。
   */
  minWidth?: number;
  ariaLabel: string;
  children: (size: ChartSize) => ReactNode;
  className?: string;
}

/**
 * 统一处理响应式尺寸：外层负责测量（并在需要时横向滚动），svg 只负责画。
 * 图表内部自行留 margin，避免每个组件重复写 ResizeObserver。
 */
export function ChartCanvas({
  height,
  minWidth,
  ariaLabel,
  children,
  className,
}: ChartCanvasProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const compact = useMediaQuery(COMPACT_MEDIA_QUERY);
  // 只有窄屏才启用保底宽度：桌面双栏里的图宁可窄一点，也不要出现横向滚动条。
  const scrollable = compact && minWidth !== undefined;

  return (
    <div
      className={cn(
        "[contain:inline-size]",
        scrollable
          ? "overscroll-x-contain overflow-x-auto overflow-y-hidden pb-1 [scrollbar-width:thin]"
          : "overflow-hidden",
        className,
      )}
      style={
        scrollable ? { maskImage: SCROLL_FADE, WebkitMaskImage: SCROLL_FADE } : undefined
      }
    >
      <div ref={ref} style={scrollable ? { minWidth } : undefined}>
        {width > 0 ? (
          <svg
            aria-label={ariaLabel}
            height={height}
            role="img"
            viewBox={`0 0 ${width} ${height}`}
            width={width}
          >
            {children({ compact, height, width })}
          </svg>
        ) : null}
      </div>
    </div>
  );
}
