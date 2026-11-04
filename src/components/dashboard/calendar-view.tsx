import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AgendaList } from "@/components/dashboard/agenda-list";
import { CalendarEventRow } from "@/components/dashboard/calendar-event-row";
import { MemberDot } from "@/components/dashboard/member-avatar";
import { MonthGrid } from "@/components/dashboard/month-grid";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  currentJstDay,
  currentJstMonth,
  deriveCalendarEventState,
  isMonthInWindow,
  jstDateKey,
  jstMonthKey,
  monthLabel,
  parseCalendarParams,
  relativeDayLabel,
  shiftMonth,
  undatedEvents,
  upcomingEvents,
  writeCalendarParams,
} from "@/lib/calendar";
import { CALENDAR_STATE_LABELS, eventAriaLabel } from "@/lib/calendar-labels";
import { formatInteger, formatTime } from "@/lib/format";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useNavigate, useSearchParams } from "@/lib/router-compat";
import { cn } from "@/lib/utils";
import type {
  CalendarEvent,
  CalendarMember,
  CalendarPageData,
  CalendarParams,
  CalendarViewMode,
} from "@/types/calendar";

const CHIP_CLASS =
  "gap-1.5 rounded-full px-2.5 text-footnote text-muted-foreground before:rounded-full hover:text-foreground data-pressed:bg-foreground data-pressed:text-background data-pressed:hover:bg-foreground data-pressed:hover:text-background";

interface CalendarViewProps {
  data: CalendarPageData;
  /** 当前页面路径，用于跨窗口切月时跳转 SSR。 */
  basePath: string;
  showMemberFilter: boolean;
}

export function CalendarView({ data, basePath, showMemberFilter }: CalendarViewProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isNarrow = useMediaQuery("max-lg");
  const [nowMs, setNowMs] = useState(() => Date.parse(data.now));

  // 首屏保持 SSR 时刻，之后每分钟重算一次状态，避免页面开久了还停在「预定」。
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const defaultMonth = currentJstMonth(now);
  const params = useMemo(
    () => parseCalendarParams(searchParams, defaultMonth),
    [searchParams, defaultMonth],
  );

  const baseEvents = useMemo(
    () =>
      data.events.map(event => ({
        ...event,
        state: deriveCalendarEventState(event, now),
      })),
    [data.events, now],
  );

  const visibleEvents = useMemo(
    () =>
      params.members.length === 0
        ? baseEvents
        : baseEvents.filter(event => params.members.includes(event.datasetId)),
    [baseEvents, params.members],
  );

  const monthEvents = useMemo(
    () => visibleEvents.filter(event => event.at && jstMonthKey(event.at) === params.month),
    [visibleEvents, params.month],
  );
  const upcoming = useMemo(() => upcomingEvents(visibleEvents, now, 7), [visibleEvents, now]);
  const undated = useMemo(() => undatedEvents(visibleEvents), [visibleEvents]);
  const mode: CalendarViewMode = params.view ?? (isNarrow ? "agenda" : "month");

  function updateParams(patch: Partial<CalendarParams>): void {
    setSearchParams(
      writeCalendarParams(searchParams, { ...params, ...patch }, defaultMonth),
      { replace: true },
    );
  }

  function navigateToMonth(month: string, day: string | null): void {
    if (isMonthInWindow(month, data.window)) {
      updateParams({ month, day });
      return;
    }

    const next = new URLSearchParams();
    next.set("month", month);
    if (day) next.set("day", day);
    if (params.view) next.set("view", params.view);
    if (params.members.length > 0) next.set("members", params.members.join(","));
    navigate(`${basePath}?${next.toString()}`);
  }

  function goToMonth(month: string): void {
    navigateToMonth(month, null);
  }

  function goToday(): void {
    const today = currentJstDay(now);
    navigateToMonth(today.slice(0, 7), today);
  }

  function focusEvent(event: CalendarEvent): void {
    const date = jstDateKey(event.at);
    if (!date) return;
    navigateToMonth(date.slice(0, 7), date);
  }

  function selectDay(day: string | null): void {
    if (!day) {
      updateParams({ day: null });
      return;
    }
    updateParams({ month: day.slice(0, 7), day });
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        actions={(
          <SegmentedControl aria-label="视图">
            <SegmentedControlItem
              aria-current={mode === "month" ? "page" : undefined}
              onClick={() => updateParams({ view: "month" })}
            >
              月
            </SegmentedControlItem>
            <SegmentedControlItem
              aria-current={mode === "agenda" ? "page" : undefined}
              onClick={() => updateParams({ view: "agenda" })}
            >
              列表
            </SegmentedControlItem>
          </SegmentedControl>
        )}
        facts={[
          { label: "本月场次", value: formatInteger(monthEvents.length) },
          { label: "未来 7 天", value: formatInteger(upcoming.length) },
        ]}
        title="日历"
      >
        按 JST 自然日 · 未来场次开播后自动收录
      </PageHeader>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            aria-label="上个月"
            onClick={() => goToMonth(shiftMonth(params.month, -1))}
            size="icon-sm"
            variant="ghost"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <h2 className="min-w-[7.5rem] text-center text-headline tabular-nums text-foreground">
            {monthLabel(params.month)}
          </h2>
          <Button
            aria-label="下个月"
            onClick={() => goToMonth(shiftMonth(params.month, 1))}
            size="icon-sm"
            variant="ghost"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          <Button onClick={goToday} size="sm" variant="outline">
            今天
          </Button>
        </div>

        {showMemberFilter
          ? (
              <MemberFilter
                members={data.members}
                onChange={members => updateParams({ members })}
                selected={params.members}
              />
            )
          : null}
      </div>

      {mode === "month"
        ? (
            <>
              <UpcomingStrip now={now} onSelect={focusEvent} upcoming={upcoming} />
              <MonthGrid
                events={monthEvents}
                month={params.month}
                now={now}
                onSelectDay={selectDay}
                selectedDay={params.day}
              />
              {undated.length > 0 && params.month === defaultMonth
                ? <UndatedBlock events={undated} />
                : null}
            </>
          )
        : (
            <AgendaList
              events={monthEvents}
              month={params.month}
              now={now}
              onNextMonth={() => goToMonth(shiftMonth(params.month, 1))}
              onShowMonth={() => updateParams({ view: "month" })}
            />
          )}

      <p className="text-caption text-ink-3">
        实心：已结束 · 空心：预定 · 圆点：直播中 · 锁：会员限定。会员限定场次只显示标题与时间，指标在解锁后可见。
      </p>
    </div>
  );
}

function MemberFilter({
  members,
  selected,
  onChange,
}: {
  members: CalendarMember[];
  selected: string[];
  onChange: (members: string[]) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="shrink-0 text-caption text-ink-3">成员</span>
      <ToggleGroup
        aria-label="按成员筛选"
        className="flex max-w-full flex-wrap gap-1"
        multiple
        onValueChange={onChange}
        size="sm"
        value={selected}
      >
        {members.map(member => (
          <ToggleGroupItem
            aria-label={`成员：${member.label}`}
            className={CHIP_CLASS}
            key={member.id}
            value={member.id}
          >
            <MemberDot color={member.color ?? "var(--member-color)"} />
            {member.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {selected.length > 0
        ? (
            <Button onClick={() => onChange([])} size="xs" variant="ghost">
              全部
            </Button>
          )
        : null}
    </div>
  );
}

function UpcomingStrip({
  upcoming,
  now,
  onSelect,
}: {
  upcoming: CalendarEvent[];
  now: Date;
  onSelect: (event: CalendarEvent) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-headline text-foreground">接下来 · 7 天</h2>
        <span className="text-caption tabular-nums text-ink-3">
          {formatInteger(upcoming.length)} 场
        </span>
      </div>

      {upcoming.length === 0
        ? (
            <p className="text-footnote text-muted-foreground">
              未来 7 天还没有安排。
            </p>
          )
        : (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {upcoming.slice(0, 5).map(event => {
                const date = jstDateKey(event.at);
                if (!date) return null;

                return (
                  <button
                    aria-label={eventAriaLabel(event)}
                    className="flex w-56 shrink-0 flex-col gap-1 rounded-lg border border-hairline bg-card px-3 py-2 text-left transition-colors duration-120 ease-out hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-member-ink"
                    key={event.key}
                    onClick={() => onSelect(event)}
                    type="button"
                  >
                    <span className="flex items-center gap-1.5 text-caption text-ink-3">
                      <MemberDot color={event.color} />
                      <span className="truncate">{event.memberLabel}</span>
                      <span className="ms-auto shrink-0 tabular-nums">
                        {relativeDayLabel(date, now)} {formatTime(event.at)}
                      </span>
                    </span>
                    <span className="truncate text-footnote text-foreground">
                      {event.title}
                    </span>
                    <span className="flex items-center gap-1 text-caption text-muted-foreground">
                      {CALENDAR_STATE_LABELS[event.state]}
                      {event.memberOnly
                        ? (
                            <>
                              <Lock aria-hidden="true" className="size-3" />
                              <span className="sr-only">会员限定</span>
                            </>
                          )
                        : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
    </section>
  );
}

function UndatedBlock({ events }: { events: CalendarEvent[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-hairline bg-card">
      <h2 className="border-b border-hairline px-3 py-2 text-footnote font-medium text-foreground">
        日期待定
        <span className="ms-2 text-caption font-normal text-ink-3">
          {formatInteger(events.length)} 场
        </span>
      </h2>
      <ul className={cn("divide-y divide-hairline")}>
        {events.map(event => (
          <li key={event.key}>
            <CalendarEventRow event={event} />
          </li>
        ))}
      </ul>
    </section>
  );
}
