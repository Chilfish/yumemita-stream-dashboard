import { ArrowRight, Lock } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ShareButton } from "@/components/dashboard/calendar/share-button";
import { Badge } from "@/components/ui/badge";
import {
  deriveCalendarEventState,
  monthDayLabel,
  weekdayLabel,
} from "@/lib/calendar";
import { eventTimeLabel, eventTitle } from "@/lib/calendar-labels";
import { CONTENT_TYPE_LABELS } from "@/lib/classify";
import { formatDurationLong } from "@/lib/format";
import { Link } from "@/lib/router-compat";
import type {
  CalendarEvent,
  CalendarEventState,
  DayPlan,
  DayPlanDay,
} from "@/types/calendar";

function StateBadge({ state }: { state: CalendarEventState }) {
  if (state === "live") return <Badge size="sm" variant="error">直播中</Badge>;
  if (state === "pending") return <Badge size="sm" variant="warning">待补录</Badge>;
  if (state === "upcoming") return <Badge size="sm" variant="outline">预定</Badge>;
  if (state === "cancelled") return <Badge size="sm" variant="secondary">已取消</Badge>;
  return <Badge size="sm" variant="secondary">已结束</Badge>;
}

function eventMeta(event: CalendarEvent): string | null {
  if (event.state === "done" && event.at && event.endAt) {
    const seconds = (Date.parse(event.endAt) - Date.parse(event.at)) / 1000;
    return Number.isFinite(seconds) && seconds > 0 ? formatDurationLong(seconds) : null;
  }
  if (event.expectedMinutes) return `预计 ${event.expectedMinutes} 分钟`;
  if (event.timeTentative) return "时段待定";
  return null;
}

function TimelineRow({ event }: { event: CalendarEvent }) {
  const meta = eventMeta(event);
  const content = (
    <>
      <span className="w-12 shrink-0 pt-0.5 text-right text-caption tabular-nums text-ink-3">
        {eventTimeLabel(event)}
      </span>

      <span className="relative flex w-3 shrink-0 justify-center">
        <span aria-hidden="true" className="absolute top-0 bottom-0 w-px bg-hairline" />
        <span
          aria-hidden="true"
          className="relative mt-1.5 size-2 rounded-full ring-2 ring-card"
          style={{ backgroundColor: event.color }}
        />
      </span>

      <span className="min-w-0 flex-1 pb-4">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="shrink-0 text-caption font-medium text-muted-foreground">
            {event.memberLabel}
          </span>
          <span className="min-w-0 text-footnote font-medium wrap-anywhere text-foreground">
            {eventTitle(event)}
          </span>
          {event.kind ? (
            <Badge size="sm" variant="outline">{CONTENT_TYPE_LABELS[event.kind]}</Badge>
          ) : null}
          <StateBadge state={event.state} />
        </span>
        <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-caption text-muted-foreground">
          {meta ? <span className="tabular-nums">{meta}</span> : null}
          {event.memberOnly ? (
            <>
              <Lock aria-hidden="true" className="size-3" />
              <span>会员限定</span>
            </>
          ) : null}
        </span>
      </span>
    </>
  );

  if (event.href) {
    return (
      <Link
        className="-mx-2 flex min-w-0 items-start gap-2 rounded-lg px-2 transition-colors duration-120 ease-out hover:bg-accent/40"
        to={event.href}
      >
        {content}
      </Link>
    );
  }

  if (event.url) {
    return (
      <a
        className="-mx-2 flex min-w-0 items-start gap-2 rounded-lg px-2 transition-colors duration-120 ease-out hover:bg-accent/40"
        href={event.url}
        rel="noreferrer"
        target="_blank"
      >
        {content}
      </a>
    );
  }

  return <div className="-mx-2 flex min-w-0 items-start gap-2 px-2">{content}</div>;
}

function DayGroup({ day, now }: { day: DayPlanDay; now: Date }) {
  const events = useMemo(
    () =>
      day.events
        .map(event => ({ ...event, state: deriveCalendarEventState(event, now) }))
        .filter(event => event.state !== "cancelled"),
    [day.events, now],
  );

  return (
    <section className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
      <h3 className="flex items-baseline gap-2">
        <span className="text-footnote font-medium text-foreground">
          {day.offset === 0 ? "今天" : "明天"}
        </span>
        <span className="text-caption text-ink-3">
          {monthDayLabel(day.date)} · {weekdayLabel(day.date)}
        </span>
        <span className="ms-auto text-caption tabular-nums text-ink-3">
          {events.length} 场
        </span>
      </h3>

      {events.length === 0
        ? <p className="ps-15 text-caption text-muted-foreground">没有排播。</p>
        : (
            <ol className="flex flex-col">
              {events.map(event => (
                <li key={event.key}>
                  <TimelineRow event={event} />
                </li>
              ))}
            </ol>
          )}
    </section>
  );
}

interface DayTimelineProps {
  plan: DayPlan | null;
  action?: ReactNode;
}

/**
 * 今天 + 明天的时间线。跨天朝活放在「明天」组里；
 * 每条事件用成员色圆点 + 时间轴，已结束的链到单场页。
 */
export function DayTimeline({ plan, action }: DayTimelineProps) {
  const [nowMs, setNowMs] = useState(() => (plan ? Date.parse(plan.now) : Date.now()));

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!plan) return null;

  const now = new Date(nowMs);
  const days = plan.days.filter(day => day.offset === 0 || day.events.length > 0);
  const hasEvents = days.some(day => day.events.length > 0);

  return (
    <section className="overflow-hidden rounded-xl border border-hairline bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-5 py-3">
        <h2 className="text-headline text-foreground">直播预定</h2>
        <div className="flex items-center gap-1">
          {action}
          {hasEvents ? <ShareButton now={now} plan={plan} /> : null}
        </div>
      </div>

      <div className="divide-y divide-hairline px-5 py-3">
        {days.map(day => (
          <DayGroup day={day} key={day.date} now={now} />
        ))}
      </div>


    </section>
  );
}

export function DayTimelineLink() {
  return (
    <Link
      className="inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground"
      to="/calendar"
    >
      查看日历
      <ArrowRight aria-hidden="true" className="size-3" />
    </Link>
  );
}
