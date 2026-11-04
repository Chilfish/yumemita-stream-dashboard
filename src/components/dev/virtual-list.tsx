"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface VirtualListProps<T> {
  items: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
  getKey: (item: T, index: number) => string;
  estimateHeight?: number;
  overscan?: number;
  className?: string;
}

/**
 * 轻量可变高虚拟列表：只渲染视口附近的行，行高由 ResizeObserver 实测。
 * 没有引入第三方依赖；过滤条件变化时由调用方的 `key` 重新挂载并重置高度缓存。
 */
export function VirtualList<T>({
  items,
  renderItem,
  getKey,
  estimateHeight = 96,
  overscan = 6,
  className,
}: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const frameRef = useRef(0);
  const topRef = useRef(0);
  const [heights, setHeights] = useState<number[]>(() =>
    new Array<number>(items.length).fill(estimateHeight),
  );
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(640);

  const { offsets, total } = useMemo(() => {
    const next = new Array<number>(items.length + 1);
    next[0] = 0;
    for (let i = 0; i < items.length; i++)
      next[i + 1] = (next[i] ?? 0) + (heights[i] ?? estimateHeight);
    return { offsets: next, total: next[items.length] ?? 0 };
  }, [estimateHeight, heights, items.length]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height) setViewport(height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 每次渲染后重新观察当前窗口内的行；图片加载导致行高变化时也能重新计算。
  useLayoutEffect(() => {
    const observer = new ResizeObserver((entries) => {
      setHeights((previous) => {
        const next = [...previous];
        let changed = false;
        for (const entry of entries) {
          const target = entry.target as HTMLElement;
          const index = Number(target.dataset.rowIndex);
          if (!Number.isInteger(index) || index < 0) continue;
          const height = target.getBoundingClientRect().height;
          if (height > 0 && Math.abs((next[index] ?? estimateHeight) - height) > 1) {
            next[index] = height;
            changed = true;
          }
        }
        return changed ? next : previous;
      });
    });
    for (const element of listRef.current?.querySelectorAll<HTMLElement>("[data-row-index]") ?? [])
      observer.observe(element);
    return () => observer.disconnect();
  });

  const start = Math.max(0, findIndex(offsets, scrollTop) - overscan);
  const end = Math.min(items.length, findIndex(offsets, scrollTop + viewport) + overscan + 1);
  const visible = items.slice(start, end);

  return (
    <div
      className={cn("relative overflow-auto rounded-2xl border bg-card", className)}
      onScroll={(event) => {
        topRef.current = event.currentTarget.scrollTop;
        if (frameRef.current) return;
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = 0;
          setScrollTop(topRef.current);
        });
      }}
      ref={scrollRef}
    >
      <ol className="relative m-0 list-none p-0" ref={listRef} style={{ height: total }}>
        {visible.map((item, index) => {
          const rowIndex = start + index;
          return (
            <li
              className="absolute inset-x-0"
              data-row-index={rowIndex}
              key={getKey(item, rowIndex)}
              style={{ top: offsets[rowIndex] }}
            >
              {renderItem(item, rowIndex)}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function findIndex(offsets: number[], value: number): number {
  let low = 0;
  let high = Math.max(0, offsets.length - 1);
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if ((offsets[mid] ?? 0) <= value) low = mid;
    else high = mid - 1;
  }
  return low;
}
