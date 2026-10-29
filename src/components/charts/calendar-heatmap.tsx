import { useMemo } from "react";
import { EmptyChart } from "@/components/charts/chart-card";
import {
  calendarMetricValue,
  type CalendarDay,
  type CalendarMetric,
} from "@/lib/aggregate";
import { formatInteger } from "@/lib/format";
import { cn } from "@/lib/utils";

const CELL = 11;
const GAP = 3;
const TOP = 18;
const LEFT = 22;
const RIGHT = 24;
const DAY_MS = 86_400_000;
const OPACITY = [0, 0.18, 0.36, 0.56, 0.76, 1] as const;
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

interface CalendarHeatmapProps {
  days: CalendarDay[];
  metric: CalendarMetric;
  ariaLabel: string;
  className?: string;
}

function parseDay(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function startOfWeek(date: Date): Date {
  return addDays(date, -((date.getUTCDay() + 6) % 7));
}

export function CalendarHeatmap({ days, metric, ariaLabel, className }: CalendarHeatmapProps) {
  const view = useMemo(() => {
    if (days.length === 0) return null;

    const firstDay = days[0];
    const lastDay = days.at(-1);
    if (!firstDay || !lastDay) return null;

    const byDate = new Map(days.map(day => [day.date, day]));
    const first = parseDay(firstDay.date);
    const last = parseDay(lastDay.date);
    const start = startOfWeek(first);
    const end = addDays(startOfWeek(last), 6);
    const weekCount = Math.round((end.getTime() - start.getTime()) / (7 * DAY_MS)) + 1;

    const cells: {
      key: string;
      week: number;
      row: number;
      day: CalendarDay | undefined;
    }[] = [];
    for (let week = 0; week < weekCount; week += 1) {
      for (let row = 0; row < 7; row += 1) {
        const date = addDays(start, week * 7 + row);
        const key = formatDay(date);
        cells.push({ day: byDate.get(key), key, row, week });
      }
    }

    const months: { label: string; week: number }[] = [];
    const cursor = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
    while (cursor <= last) {
      const anchor = cursor < start ? start : cursor;
      const week = Math.floor((anchor.getTime() - start.getTime()) / (7 * DAY_MS));
      if (months.at(-1)?.week !== week) {
        months.push({ label: `${cursor.getUTCMonth() + 1} 月`, week });
      }
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    const values = days.map(day => calendarMetricValue(day, metric));
    return {
      cells,
      max: Math.max(1, ...values),
      months,
      weekCount,
    };
  }, [days, metric]);

  if (!view) {
    return (
      <EmptyChart
        height={120}
        hint="需要场次的开播日期；当前 manifest 里没有可用日期。"
        message="还没有可用的直播日期"
      />
    );
  }

  const color = "var(--member-color, var(--chart-1))";
  const width = LEFT + view.weekCount * (CELL + GAP) + RIGHT;
  const height = TOP + 7 * (CELL + GAP);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="overflow-x-auto pb-1 [contain:inline-size]">
        <svg
          aria-label={ariaLabel}
          className="block"
          height={height}
          role="img"
          width={width}
        >
          {view.months.map(month => (
            <text
              className="fill-ink-3 text-[9px] font-semibold"
              key={`${month.label}-${month.week}`}
              x={LEFT + month.week * (CELL + GAP)}
              y={10}
            >
              {month.label}
            </text>
          ))}

          {WEEKDAY_LABELS.map((label, row) =>
            row % 2 === 0 ? (
              <text
                className="fill-ink-3 text-[9px]"
                key={label}
                x={0}
                y={TOP + row * (CELL + GAP) + CELL - 2}
              >
                {label}
              </text>
            ) : null,
          )}

          {view.cells.map(cell => {
            const value = cell.day ? calendarMetricValue(cell.day, metric) : 0;
            const level =
              value === 0 ? 0 : Math.max(1, Math.min(5, Math.ceil((value / view.max) * 5)));

            return (
              <rect
                className="transition-opacity duration-120 ease-out"
                fill={level === 0 ? "var(--hairline)" : color}
                fillOpacity={level === 0 ? 1 : (OPACITY[level] ?? 1)}
                height={CELL}
                key={cell.key}
                rx={2}
                width={CELL}
                x={LEFT + cell.week * (CELL + GAP)}
                y={TOP + cell.row * (CELL + GAP)}
              >
                <title>
                  {cell.day
                    ? `${cell.key}：${cell.day.streams} 场 · ${formatInteger(cell.day.chat)} 条弹幕 · ${formatInteger(cell.day.superchats)} 笔 SC`
                    : `${cell.key}：没有直播`}
                </title>
              </rect>
            );
          })}
        </svg>
      </div>

      <div className="flex items-center gap-1 text-caption text-ink-3">
        <span>少</span>
        {[1, 2, 3, 4, 5].map(level => (
          <span
            aria-hidden="true"
            className="size-2.5 rounded-[2px]"
            key={level}
            style={{ backgroundColor: color, opacity: OPACITY[level] }}
          />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}
