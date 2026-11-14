import { useMemo, useState } from "react";
import { CalendarHeatmap } from "@/components/charts/calendar-heatmap";
import { Panel, PanelBody, PanelHead } from "@/components/dashboard/primitives/panel";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  buildCalendarDays,
  type CalendarMetric,
} from "@/lib/aggregate";
import type { StreamSummary } from "@/types/dataset";

interface HomeCalendarProps {
  rows: StreamSummary[];
}

const METRIC_OPTIONS: { value: CalendarMetric; label: string }[] = [
  { value: "chat", label: "弹幕" },
  { value: "streams", label: "场次" },
  { value: "superchats", label: "SC" },
];

function isCalendarMetric(value: string | undefined): value is CalendarMetric {
  return METRIC_OPTIONS.some(option => option.value === value);
}

export function HomeCalendar({ rows }: HomeCalendarProps) {
  const days = useMemo(() => buildCalendarDays(rows), [rows]);
  const [metric, setMetric] = useState<CalendarMetric>("chat");
  const label = METRIC_OPTIONS.find(option => option.value === metric)?.label ?? "弹幕";

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
        title="开播热力图"
      />
      <PanelBody>
        <CalendarHeatmap
          ariaLabel={`${first ?? ""} 至 ${last ?? ""} 的每日${label}热力图`}
          days={days}
          metric={metric}
        />
      </PanelBody>
    </Panel>
  );
}
