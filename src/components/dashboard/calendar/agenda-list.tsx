import { CalendarDays } from "lucide-react";
import { useMemo } from "react";
import { CalendarEventRow } from "@/components/dashboard/calendar/calendar-event-row";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { agendaDayLabel, groupEventsByDate } from "@/lib/calendar";
import type { CalendarEvent } from "@/types/calendar";

interface AgendaListProps {
  month: string;
  now: Date;
  events: CalendarEvent[];
  onNextMonth: () => void;
  onShowMonth: () => void;
  /** 当前是否有成员筛选；用于区分「没有排播」与「筛选后为空」。 */
  filtered?: boolean;
  onClearFilter?: () => void;
}

/**
 * 窄屏默认视图：按 JST 自然日分组，日期头吸附在顶栏下方。
 * 月网格在手机上只剩日期和圆点，议程列表承担真正可读的那一层。
 */
export function AgendaList({
  month,
  now,
  events,
  onNextMonth,
  onShowMonth,
  filtered = false,
  onClearFilter,
}: AgendaListProps) {
  const byDate = useMemo(() => groupEventsByDate(events), [events]);
  const dates = useMemo(
    () => [...byDate.keys()].filter(date => date.startsWith(month)).sort(),
    [byDate, month],
  );

  if (dates.length === 0) {
    return (
      <Empty className="rounded-xl border border-hairline bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarDays aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{filtered ? "没有符合条件的安排" : "这个月还没有安排"}</EmptyTitle>
          <EmptyDescription>
            {filtered
              ? "当前成员筛选下这个月没有排播。"
              : "换个月份，或者回到当前月查看接下来的场次。"}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex flex-wrap justify-center gap-2">
            {filtered && onClearFilter ? (
              <Button onClick={onClearFilter} size="sm" variant="outline">
                清除成员筛选
              </Button>
            ) : null}
            <Button onClick={onShowMonth} size="sm" variant="outline">
              看月视图
            </Button>
            <Button onClick={onNextMonth} size="sm">
              下个月
            </Button>
          </div>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {dates.map(date => {
        const dayEvents = byDate.get(date) ?? [];

        return (
          <section
            className="overflow-hidden rounded-xl border border-hairline bg-card"
            key={date}
          >
            <h2 className="flex items-baseline gap-2 border-b border-hairline px-3 py-2">
              <span className="text-footnote font-medium text-foreground">
                {agendaDayLabel(date, now)}
              </span>
              <span className="ms-auto text-caption tabular-nums text-ink-3">
                {dayEvents.length} 场
              </span>
            </h2>
            <ul className="divide-y divide-hairline">
              {dayEvents.map(event => (
                <li key={event.key}>
                  <CalendarEventRow event={event} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
