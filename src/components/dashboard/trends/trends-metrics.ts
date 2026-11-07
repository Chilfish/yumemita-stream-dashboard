import type { MonthlyPoint } from "@/lib/aggregate";

export type TrendMetric = "avgConcurrent" | "chatPerMinute" | "streams" | "superchats";

export const METRIC_OPTIONS: { value: TrendMetric; label: string; unit: string }[] = [
  { value: "streams", label: "场次", unit: "场" },
  { value: "chatPerMinute", label: "弹幕/分", unit: "条/分" },
  { value: "superchats", label: "SC", unit: "笔" },
  { value: "avgConcurrent", label: "平均同接", unit: "人" },
];

export function isTrendMetric(value: string | undefined): value is TrendMetric {
  return METRIC_OPTIONS.some(option => option.value === value);
}

export function metricValue(point: MonthlyPoint, metric: TrendMetric): number | null {
  switch (metric) {
    case "streams":
      return point.streams;
    case "chatPerMinute":
      return point.chatPerMinute;
    case "superchats":
      return point.superchats;
    case "avgConcurrent":
      return point.avgConcurrent;
  }
}
