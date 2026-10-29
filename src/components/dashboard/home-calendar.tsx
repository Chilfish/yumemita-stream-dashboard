import { useMemo, useState } from "react";
import { CalendarHeatmap } from "@/components/charts/calendar-heatmap";
import { Panel, PanelBody, PanelHead, PanelNote } from "@/components/dashboard/panel";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  buildCalendarDays,
  calendarMetricValue,
  type CalendarDay,
  type CalendarMetric,
} from "@/lib/aggregate";
import { formatInteger } from "@/lib/format";
import type { StreamSummary } from "@/types/dataset";

interface HomeCalendarProps {
  rows: StreamSummary[];
}

const METRIC_OPTIONS: { value: CalendarMetric; label: string; unit: string }[] = [
  { value: "chat", label: "弹幕", unit: "条" },
  { value: "streams", label: "场次", unit: "场" },
  { value: "superchats", label: "SC", unit: "笔" },
];

function isCalendarMetric(value: string | undefined): value is CalendarMetric {
  return METRIC_OPTIONS.some(option => option.value === value);
}

export function HomeCalendar({ rows }: HomeCalendarProps) {
  const days = useMemo(() => buildCalendarDays(rows), [rows]);
  const [metric, setMetric] = useState<CalendarMetric>("chat");
  const active =
    METRIC_OPTIONS.find(option => option.value === metric) ?? {
      label: "弹幕",
      unit: "条",
      value: "chat" as CalendarMetric,
    };

  const total = days.reduce((sum, day) => sum + calendarMetricValue(day, metric), 0);
  const busiest = days.reduce<CalendarDay | null>((best, day) => {
    if (!best) return day;
    return calendarMetricValue(day, metric) > calendarMetricValue(best, metric) ? day : best;
  }, null);
  const first = days[0]?.date;
  const last = days.at(-1)?.date;

  function changeMetric(next: string[]): void {
    const [value] = next;
    if (isCalendarMetric(value)) setMetric(value);
  }

  return (
    <Panel>
      <PanelHead
        actions={
          <ToggleGroup
            aria-label="日历指标"
            onValueChange={changeMetric}
            size="sm"
            value={[metric]}
          >
            {METRIC_OPTIONS.map(option => (
              <ToggleGroupItem
                className="rounded-full px-2.5 text-footnote text-muted-foreground before:rounded-full hover:text-foreground data-pressed:bg-foreground data-pressed:text-background data-pressed:hover:bg-foreground data-pressed:hover:text-background"
                key={option.value}
                value={option.value}
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
        meta={`按 JST 自然日；颜色越深表示当日${active.label}越多`}
        title="更新日历"
      />
      <PanelBody>
        <CalendarHeatmap
          ariaLabel={`${first ?? ""} 至 ${last ?? ""} 的每日${active.label}热力图`}
          days={days}
          metric={metric}
        />
      </PanelBody>
      <PanelNote>
        {first && last
          ? `${first} – ${last} · ${formatInteger(days.length)} 个直播日 · 共 ${formatInteger(total)} ${active.unit}${
              busiest
                ? ` · 最活跃 ${busiest.date}（${formatInteger(calendarMetricValue(busiest, metric))} ${active.unit}）`
                : ""
            }`
          : "还没有可用的直播日期"}
      </PanelNote>
    </Panel>
  );
}
