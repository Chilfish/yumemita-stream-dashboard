import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";

interface ScaleLike {
  invert: (value: number) => number;
}

/**
 * 图表 hover 索引：pointermove 先合并到下一帧，索引未变时不触发重渲染。
 * 进入 / 按下时缓存一次 rect，避免每次移动都做同步布局读取。
 */
export function useThrottledHover() {
  const [index, setIndex] = useState<number | null>(null);
  const frame = useRef<number | null>(null);
  const pending = useRef<number | null>(null);
  const bounds = useRef<DOMRect | null>(null);

  useEffect(() => () => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
  }, []);

  const schedule = useCallback((next: number) => {
    pending.current = next;
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const value = pending.current;
      pending.current = null;
      setIndex(current => (current === value ? current : value));
    });
  }, []);

  const clear = useCallback(() => {
    pending.current = null;
    if (frame.current != null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    bounds.current = null;
    setIndex(null);
  }, []);

  const enter = useCallback((event: PointerEvent<SVGRectElement>) => {
    bounds.current = event.currentTarget.getBoundingClientRect();
  }, []);

  const move = useCallback(
    (event: PointerEvent<SVGRectElement>, scale: ScaleLike, length: number) => {
      const rect = bounds.current ?? event.currentTarget.getBoundingClientRect();
      const raw = Math.round(scale.invert(event.clientX - rect.left));
      schedule(Math.min(Math.max(raw, 0), Math.max(0, length - 1)));
    },
    [schedule],
  );

  const down = useCallback(
    (event: PointerEvent<SVGRectElement>, scale: ScaleLike, length: number) => {
      bounds.current = event.currentTarget.getBoundingClientRect();
      move(event, scale, length);
    },
    [move],
  );

  return { index, clear, enter, move, down };
}
