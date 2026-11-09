import { ExternalLink, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { eventAriaLabel, eventTimeLabel, eventTitle } from "@/lib/calendar-labels";
import { Link } from "@/lib/router-compat";
import { cn } from "@/lib/utils";
import type { CalendarEvent, CalendarEventState } from "@/types/calendar";

function StateBadge({ state }: { state: CalendarEventState }) {
  if (state === "live") {
    return <Badge size="sm" variant="error">直播中</Badge>;
  }
  if (state === "upcoming") {
    return <Badge size="sm" variant="outline">预定</Badge>;
  }
  if (state === "pending") {
    return <Badge size="sm" variant="warning">待补录</Badge>;
  }
  if (state === "cancelled") {
    return <Badge size="sm" variant="secondary">已取消</Badge>;
  }
  return null;
}

interface CalendarEventRowProps {
  event: CalendarEvent;
  className?: string;
}

const ROW_CLASS =
  "group flex w-full min-w-0 items-start gap-2.5 px-3 py-2.5 text-left transition-colors duration-120 ease-out focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-member-ink";

/**
 * 日历里的一条事件。已结束的走站内单场页；未来场有 YouTube 链接时外链。
 * 会员限定只显示元数据，不展开指标。
 */
export function CalendarEventRow({ event, className }: CalendarEventRowProps) {
  const content = (
    <>
      <span className="w-10 shrink-0 pt-0.5 text-right text-caption tabular-nums text-ink-3">
        {eventTimeLabel(event)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-caption font-medium text-foreground">
            {event.memberLabel}
          </span>
          {event.memberOnly ? (
            <>
              <Lock aria-hidden="true" className="size-3 shrink-0 text-ink-3" />
              <span className="sr-only">会员限定</span>
            </>
          ) : null}
          <span className="ms-auto shrink-0">
            <StateBadge state={event.state} />
          </span>
        </span>

        <span
          className={cn(
            "mt-0.5 line-clamp-2 block wrap-anywhere font-medium",
            event.state === "cancelled" ? "text-muted-foreground line-through" : "text-foreground",
          )}
          style={{
            fontSize: "var(--text-footnote)",
            lineHeight: "var(--text-footnote--line-height)",
          }}
        >
          {eventTitle(event)}
        </span>
      </span>

      {!event.href && event.url ? (
        <ExternalLink aria-hidden="true" className="mt-1 size-3.5 shrink-0 text-ink-3" />
      ) : null}
    </>
  );

  if (event.href) {
    return (
      <Link aria-label={eventAriaLabel(event)} className={cn(ROW_CLASS, className)} to={event.href}>
        {content}
      </Link>
    );
  }

  if (event.url) {
    return (
      <a
        aria-label={`${eventAriaLabel(event)}，在 YouTube 打开`}
        className={cn(ROW_CLASS, "hover:bg-accent/50", className)}
        href={event.url}
        rel="noreferrer"
        target="_blank"
      >
        {content}
      </a>
    );
  }

  return <div className={cn(ROW_CLASS, className)}>{content}</div>;
}
