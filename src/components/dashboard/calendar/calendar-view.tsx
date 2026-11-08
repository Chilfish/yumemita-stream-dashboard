import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AgendaList } from "@/components/dashboard/calendar/agenda-list";
import { CalendarEventRow } from "@/components/dashboard/calendar/calendar-event-row";
import { DayTimeline } from "@/components/dashboard/calendar/day-timeline";
import { MemberDot } from "@/components/dashboard/primitives/member-avatar";
import { MonthGrid } from "@/components/dashboard/calendar/month-grid";
import { PageHeader } from "@/components/dashboard/primitives/page-header";
import { Button } from "@/components/ui/button";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  buildDayPlan,
  currentJstDay,
  currentJstMonth,
  deriveCalendarEventState,
  isMonthInWindow,
  jstMonthKey,
  monthLabel,
  parseCalendarParams,
  shiftMonth,
  undatedEvents,
  writeCalendarParams,
} from "@/lib/calendar";
import { formatInteger } from "@/lib/format";
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

  // URL 里可能存在已不存在的成员 id；先过滤，避免整页被一个无效值筛空。
  const knownMemberIds = useMemo(() => new Set(data.members.map(member => member.id)), [data.members]);
  const selectedMembers = useMemo(
    () => params.members.filter(id => knownMemberIds.has(id)),
    [params.members, knownMemberIds],
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
      selectedMembers.length === 0
        ? baseEvents
        : baseEvents.filter(event => selectedMembers.includes(event.datasetId)),
    [baseEvents, selectedMembers],
  );

  const monthEvents = useMemo(
    () => visibleEvents.filter(event => event.at && jstMonthKey(event.at) === params.month),
    [visibleEvents, params.month],
  );
  const dayPlan = useMemo(
    () => buildDayPlan(visibleEvents, now, 2, data.members),
    [visibleEvents, now, data.members],
  );
  const nearTermCount = dayPlan.days.reduce(
    (total, day) => total + day.events.filter(event => event.state !== "cancelled").length,
    0,
  );
  const undated = useMemo(() => undatedEvents(visibleEvents), [visibleEvents]);
  const mode: CalendarViewMode = params.view ?? (isNarrow ? "agenda" : "month");

  function updateParams(patch: Partial<CalendarParams>): void {
    // 函数式更新：同一 tick 的两次写入都基于最新 URL，不会互相覆盖。
    setSearchParams((previous) => {
      const current = parseCalendarParams(previous, defaultMonth);
      return writeCalendarParams(previous, { ...current, ...patch }, defaultMonth);
    }, { replace: true });
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
          { label: "今天与明天", value: formatInteger(nearTermCount) },
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
                selected={selectedMembers}
              />
            )
          : null}
      </div>

      <DayTimeline now={now} plan={dayPlan} />

      {mode === "month"
        ? (
            <>
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
              filtered={selectedMembers.length > 0}
              month={params.month}
              now={now}
              onClearFilter={() => updateParams({ members: [] })}
              onNextMonth={() => goToMonth(shiftMonth(params.month, 1))}
              onShowMonth={() => updateParams({ view: "month" })}
            />
          )}

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
