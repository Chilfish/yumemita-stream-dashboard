/** 图表共用的响应式几何：断点与 index.css 的移动端字阶保持一致（Tailwind md 之前）。 */
export const COMPACT_MEDIA_QUERY = "(max-width: 47.99rem)";

/** 窄屏收紧绘图区留白，把宽度还给数据。 */
const COMPACT_MARGIN_SCALE = 0.78;

/** 窄屏滚动图表的宽度区间：低于 floor 不滚（内容本来就放得下），高于 ceiling 也没必要再宽。 */
const MIN_WIDTH_FLOOR = 480;
const MIN_WIDTH_CEILING = 960;

export interface ChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function resolveMargin(margin: ChartMargin, compact: boolean): ChartMargin {
  if (!compact) return margin;

  const scale = (value: number) => Math.round(value * COMPACT_MARGIN_SCALE);

  return {
    bottom: scale(margin.bottom),
    left: scale(margin.left),
    right: scale(margin.right),
    top: scale(margin.top),
  };
}

/**
 * 窄屏最小绘图宽度：每个数据点至少占 `perPoint`，
 * 容器更窄时由 ChartCanvas 横向滚动，而不是把数据挤在一起。
 */
export function minWidthForPoints(
  count: number,
  perPoint: number,
  { floor = MIN_WIDTH_FLOOR, ceiling = MIN_WIDTH_CEILING } = {},
): number {
  return Math.min(ceiling, Math.max(floor, Math.round(count * perPoint)));
}
