import { Lock } from "lucide-react";
import { useMemo } from "react";
import { CalendarEventRow } from "@/components/dashboard/calendar/calendar-event-row";
import { eventAriaLabel, eventTimeLabel, eventTitle } from "@/lib/calendar-labels";
import {
  Popover,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  buildMonthGrid,
  groupEventsByDate,
  relativeDayLabel,
  weekdayLabel,
} from "@/lib/calendar";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/types/calendar";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

function dayAriaLabel(date: string, events: CalendarEvent[], now: Date): string {
  const day = relativeDayLabel(date, now);
  if (events.length === 0) return `${day}，没有安排`;

  const items = events.map(event => eventAriaLabel(event));
  return `${day}，${events.length} 场：${items.join("；")}`;
}

function EventLine({ event }: { event: CalendarEvent }) {
  const muted = event.state === "cancelled" || event.state === "pending";
  const barStyle = event.state === "upcoming"
    ? { backgroundColor: "transparent", boxShadow: `inset 0 0 0 1px ${event.color}` }
    : muted
      ? { backgroundColor: "var(--muted-foreground)" }
      : { backgroundColor: event.color };

  return (
    <span className="flex min-w-0 items-center gap-1 px-0.5" title={eventTitle(event)}>
      <span
        aria-hidden="true"
        className="h-3.5 w-0.5 shrink-0 rounded-full"
        style={barStyle}
      />
      <span className="shrink-0 text-[10px] leading-[0.875rem] font-normal tracking-normal tabular-nums text-ink-3">
        {eventTimeLabel(event)}
      </span>
      <span
        className={cn("min-w-0 truncate", muted && "line-through")}
        style={{
          color: muted ? "var(--muted-foreground)" : "var(--foreground)",
          fontSize: "var(--text-footnote)",
          lineHeight: "var(--text-footnote--line-height)",
        }}
      >
        {eventTitle(event)}
      </span>
      {event.memberOnly ? (
        <Lock aria-hidden="true" className="size-2.5 shrink-0 text-ink-3" />
      ) : null}
      {event.state === "live" ? (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 animate-pulse rounded-full bg-destructive motion-reduce:animate-none"
        />
      ) : null}
    </span>
  );
}

interface DayCellProps {
  date: string;
  inMonth: boolean;
  isToday: boolean;
  selected: boolean;
  events: CalendarEvent[];
  now: Date;
  onSelectDay: (day: string | null) => void;
}

function DayCell({
  date,
  inMonth,
  isToday,
  selected,
  events,
  now,
  onSelectDay,
}: DayCellProps) {
  const label = dayAriaLabel(date, events, now);

  return (
    <Popover
      open={selected}
      onOpenChange={next => onSelectDay(next ? date : null)}
    >
      <PopoverTrigger
        aria-label={label}
        className={cn(
          "relative flex min-h-20 w-full flex-col gap-1 p-1.5 text-left outline-none transition-colors duration-120 ease-out sm:min-h-28",
          "hover:bg-muted/40 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          !inMonth && "opacity-45",
          selected && "bg-muted/60",
        )}
        type="button"
      >
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center font-medium tabular-nums",
            isToday ? "rounded-full bg-foreground text-background" : "text-foreground",
          )}
          style={{
            fontSize: "var(--text-footnote)",
            lineHeight: "var(--text-footnote--line-height)",
          }}
        >
          {Number(date.slice(-2))}
        </span>

        <span className="hidden min-w-0 flex-col gap-[3px] sm:flex">
          {events.map(event => (
            <EventLine event={event} key={event.key} />
          ))}
        </span>

        <span className="flex flex-wrap items-center gap-0.5 px-1 sm:hidden">
          {events.slice(0, 4).map(event => (
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full"
              key={event.key}
              style={{ backgroundColor: event.color }}
            />
          ))}
          {events.length > 4 ? (
            <span className="text-caption tabular-nums text-ink-3">
              +{events.length - 4}
            </span>
          ) : null}
        </span>
      </PopoverTrigger>

      <PopoverPopup
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)]"
        side="bottom"
      >
        <PopoverTitle className="pb-2 text-footnote font-medium text-foreground">
          {relativeDayLabel(date, now)}
          <span className="ms-1.5 text-muted-foreground">{weekdayLabel(date)}</span>
          <span className="ms-2 text-caption font-normal text-ink-3">
            {events.length} 场
          </span>
        </PopoverTitle>

        {events.length > 0
          ? (
              <ul className="divide-y divide-hairline">
                {events.map(event => (
                  <li key={event.key}>
                    <CalendarEventRow className="px-0" event={event} />
                  </li>
                ))}
              </ul>
            )
          : (
              <p className="pb-1 text-footnote text-muted-foreground">
                这一天没有安排。
                <span className="mt-1 block text-caption text-ink-3">
                  未来场次会提前出现在这里。
                </span>
              </p>
            )}
      </PopoverPopup>
    </Popover>
  );
}

interface MonthGridProps {
  month: string;
  now: Date;
  events: CalendarEvent[];
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
}

/**
 * 月网格。桌面显示「时间 + 标题」的 chip，窄屏只留成员色圆点；
 * 点整格打开当天列表，不把详情塞进格子里。
 */
export function MonthGrid({
  month,
  now,
  events,
  selectedDay,
  onSelectDay,
}: MonthGridProps) {
  const weeks = useMemo(() => buildMonthGrid(month, now), [month, now]);
  const byDate = useMemo(() => groupEventsByDate(events), [events]);

  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-card">
      <div className="grid grid-cols-7 border-b border-hairline bg-muted/40">
        {WEEKDAYS.map(label => (
          <div
            className="px-2 py-1.5 text-center text-footnote text-ink-3"
            key={label}
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 divide-x divide-y divide-hairline">
        {weeks.flatMap(week =>
          week.days.map(cell => (
            <DayCell
              date={cell.date}
              events={byDate.get(cell.date) ?? []}
              inMonth={cell.inMonth}
              isToday={cell.isToday}
              key={cell.date}
              now={now}
              onSelectDay={onSelectDay}
              selected={selectedDay === cell.date}
            />
          )),
        )}
      </div>
    </div>
  );
}
