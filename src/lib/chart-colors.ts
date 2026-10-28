/** 图表配色。映射到主题 token：chart-1 跟随成员色，其余为中性灰与语义色，深浅色自动适配。 */
export const CHART_COLORS = [
  "var(--member-color, var(--chart-1))",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;
