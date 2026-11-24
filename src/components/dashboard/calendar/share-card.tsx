import { forwardRef } from "react";
import { ContentTypeIcon } from "@/components/dashboard/calendar/content-type-icon";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
} from "@/components/ui/avatar";
import { deriveCalendarEventState, monthDayLabel } from "@/lib/calendar";
import { eventMemberLabel, eventTimeLabel, eventTitle } from "@/lib/calendar-labels";
import { CONTENT_TYPE_LABELS } from "@/lib/classify";
import { readableOn } from "@/lib/color";
import { assetUrl } from "@/lib/utils";
import type { CalendarEvent, CalendarMember, DayPlan, DayPlanDay } from "@/types/calendar";

const MAX_EVENTS = 7;

interface Person {
  id: string;
  label: string;
  avatar: string | null;
  color: string | null;
}

function toPerson(
  id: string,
  fallback: { label: string, avatar: string | null, color: string | null },
  members: Map<string, CalendarMember>,
): Person {
  const member = members.get(id);
  return {
    id,
    label: member?.label ?? fallback.label,
    avatar: member?.avatar ?? fallback.avatar,
    color: member?.color ?? fallback.color,
  };
}

/**
 * 卡片头像按「在场的人」展示：成员频道是 owner + 参与者；
 * 官方账号本身不画头像，只显示 participantIds 里的成员，没有参与者就留空。
 */
function eventPeople(event: CalendarEvent, members: Map<string, CalendarMember>): Person[] {
  const participants = event.participantIds.map((id, index) =>
    toPerson(
      id,
      { label: event.participantLabels[index] ?? id, avatar: null, color: null },
      members,
    ),
  );
  if (event.memberKind === "official") return participants;

  return [
    toPerson(event.datasetId, {
      label: event.memberLabel,
      avatar: event.memberAvatar,
      color: event.color,
    }, members),
    ...participants,
  ];
}

function PersonAvatar({ person, className }: { person: Person, className?: string }) {
  return (
    <Avatar className={className}>
      {person.avatar ? <AvatarImage alt="" src={assetUrl(person.avatar)} /> : null}
      <AvatarFallback
        className="font-semibold"
        style={person.color
          ? { backgroundColor: person.color, color: readableOn(person.color) }
          : undefined}
      >
        {person.label.slice(0, 1)}
      </AvatarFallback>
    </Avatar>
  );
}

function EventAvatars({ event, members }: {
  event: CalendarEvent
  members: Map<string, CalendarMember>
}) {
  const people = eventPeople(event, members);
  if (people.length === 0) return null;
  if (people.length === 1) {
    return (
      <PersonAvatar
        className="[--avatar-size:--spacing(12)] ring-2 ring-white/80"
        person={people[0]!}
      />
    );
  }

  return (
    <AvatarGroup className="[--avatar-size:--spacing(12)]">
      {people.map(person => <PersonAvatar key={person.id} person={person} />)}
    </AvatarGroup>
  );
}

function DayGroup({ day, now, members }: {
  day: DayPlanDay
  now: Date
  members: Map<string, CalendarMember>
}) {
  const events = day.events
    .map(event => ({ ...event, state: deriveCalendarEventState(event, now) }))
    .filter(event => event.state !== "cancelled");

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stone-700/10 py-3">
        <h3 className="text-xl font-semibold text-stone-700">
          {day.offset === 0 ? "今天" : "明天"} · {monthDayLabel(day.date)}
        </h3>
        <span className="text-lg tabular-nums text-stone-400">{events.length} 场</span>
      </div>

      <div className="divide-y divide-stone-700/10">
        {events.map(event => (
          <div className="flex items-start gap-4 py-4" key={event.key}>
            <div className="w-20 shrink-0 self-center text-center text-2xl font-semibold leading-none tabular-nums text-stone-800">
              {eventTimeLabel(event)}
            </div>

            <div className="shrink-0 self-center">
              <EventAvatars event={event} members={members} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-lg text-stone-500">
                <span className="min-w-0 truncate">{eventMemberLabel(event)}</span>
                {event.kind ? (
                  <>
                    <ContentTypeIcon kind={event.kind} />
                    <span className="shrink-0 text-base text-stone-400">
                      {CONTENT_TYPE_LABELS[event.kind]}
                    </span>
                  </>
                ) : null}
              </div>
              <div className="line-clamp-3 text-3xl font-semibold leading-9 tracking-tight wrap-anywhere text-stone-800">
                {eventTitle(event)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

interface ShareCardProps {
  plan: DayPlan;
  now: Date;
}

/**
 * 分享卡片的真实渲染节点，宽度固定为 75rem（1200px），高度由内容决定。
 * `modern-screenshot` 直接抓这个 DOM，间距和对齐全部交给 Tailwind。
 */
export const ShareCard = forwardRef<HTMLDivElement, ShareCardProps>(function ShareCard(
  { plan, now },
  ref,
) {
  const days = plan.days
    .map(day => ({
      ...day,
      events: day.events
        .map(event => ({ ...event, state: deriveCalendarEventState(event, now) }))
        .filter(event => event.state !== "cancelled"),
    }))
    .filter(day => day.events.length > 0);
  const flat = days.flatMap(day => day.events);
  const shown = flat.slice(0, MAX_EVENTS);
  const hidden = flat.length - shown.length;
  const visibleDays = days
    .map(day => ({ ...day, events: day.events.filter(event => shown.includes(event)) }))
    .filter(day => day.events.length > 0);

  const members = new Map(plan.members.map(member => [member.id, member]));

  const first = shown[0]?.date ?? "";
  const last = shown[shown.length - 1]?.date ?? first;
  const range = first && last && first !== last
    ? `${monthDayLabel(first)} – ${monthDayLabel(last)}`
    : monthDayLabel(first);

  return (
    <div
      className="relative w-[75rem] overflow-hidden bg-pink-200 font-sans text-stone-800 [text-size-adjust:100%] [-webkit-text-size-adjust:100%]"
      ref={ref}
    >
      <img
        alt=""
        className="pointer-events-none absolute inset-0 size-full object-cover"
        src="/share/bg_member_list.webp"
      />
      <div className="pointer-events-none absolute inset-0 bg-white/15" />

      <div className="relative flex flex-col px-24 pt-20 pb-16">
        <p className="text-2xl tracking-widest text-stone-500">夢限大みゅーたいぷ</p>
        <h1 className="mt-2 text-7xl font-bold leading-none tracking-tight text-stone-800">
          直播日程
        </h1>
        <div className="mt-3 h-1.5 w-24 rounded-full bg-gradient-to-r from-pink-300 via-amber-200 to-violet-300" />
        <p className="mt-5 text-2xl text-stone-500">{range} · JST</p>

        <div className="mt-10 rounded-3xl border border-white/70 bg-white/55 px-12 py-2">
          {visibleDays.map(day => (
            <DayGroup day={day} key={day.date} members={members} now={now} />
          ))}

          {hidden > 0 ? (
            <p className="py-3 text-lg text-stone-400">还有 {hidden} 场未显示</p>
          ) : null}
        </div>

        <div className="mt-10 flex items-center justify-between text-lg text-stone-400">
          <span>夢限大みゅーたいぷ · ymmt.chilfish.top</span>
          <span className="text-sm tracking-widest">LIVE SCHEDULE</span>
        </div>
      </div>
    </div>
  );
});
