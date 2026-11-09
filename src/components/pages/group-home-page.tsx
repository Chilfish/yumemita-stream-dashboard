import { GroupHero } from "@/components/dashboard/group/group-hero";
import { GroupMemberPanel } from "@/components/dashboard/group/group-member-panel";
import { GroupOnThisDay } from "@/components/dashboard/group/group-on-this-day";
import { GroupPulse } from "@/components/dashboard/group/group-pulse";
import { DayTimeline, DayTimelineLink } from "@/components/dashboard/calendar/day-timeline";
import { useGroupDataContext } from "@/components/dashboard/contexts/group-data-context";
import { PageHeader } from "@/components/dashboard/primitives/page-header";
import { formatDate, formatTime } from "@/lib/format";
import type { DayPlan } from "@/types/calendar";
import type { GroupStreamSummary } from "@/types/group";

interface GroupHomePageProps {
  dayPlan?: DayPlan | null;
  /** JST 今天的 `MM-DD`。 */
  monthDay?: string;
  onThisDay?: GroupStreamSummary[];
}

/**
 * 组首页：先回答「最近谁播了」，再给全组状态，最后才是浏览入口。
 * 顺序即优先级——脉冲只有三行数字，hero 拿走整块封面，最近更新与入口留在下面。
 */
export function GroupHomePage({ dayPlan, monthDay = "", onThisDay = [] }: GroupHomePageProps) {
  const { attendanceEnd, attendanceStart, days, members, rows, totals } = useGroupDataContext();
  const latest = rows[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <PageHeader
          className="border-b-0 pb-0"
          eyebrow={`${members.length} 位成员`}
          title="全组"
        >
        </PageHeader>
      </div>

      <DayTimeline action={<DayTimelineLink />} plan={dayPlan ?? null} />

      <GroupHero members={members} />
      <GroupOnThisDay monthDay={monthDay} rows={onThisDay} />
      <GroupMemberPanel
        attendanceEnd={attendanceEnd}
        attendanceStart={attendanceStart}
        days={days}
        members={members}
      />
    </div>
  );
}
