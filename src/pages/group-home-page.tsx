import { GroupHero } from "@/components/dashboard/group-hero";
import { GroupMemberEntries } from "@/components/dashboard/group-member-entries";
import { GroupPulse } from "@/components/dashboard/group-pulse";
import { GroupRecentUpdates } from "@/components/dashboard/group-recent-updates";
import { useGroupDataContext } from "@/components/dashboard/group-data-context";
import { PageHeader } from "@/components/dashboard/page-header";
import { formatDate, formatTime } from "@/lib/format";

/**
 * 组首页：先回答「最近谁播了」，再给全组状态，最后才是浏览入口。
 * 顺序即优先级——脉冲只有三行数字，hero 拿走整块封面，最近更新与入口留在下面。
 */
export function GroupHomePage() {
  const { members, rows, totals } = useGroupDataContext();
  const latest = rows[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <PageHeader
          className="border-b-0 pb-0"
          eyebrow={`${members.length} 位成员`}
          title="全组"
        >
          {latest
            ? `最近更新 ${formatDate(latest.startedAt)} ${formatTime(latest.startedAt)} · ${latest.memberLabel}`
            : "还没有加载到任何场次"}
        </PageHeader>

        <GroupPulse totals={totals} />
      </div>

      <GroupHero members={members} />
      <GroupRecentUpdates rows={rows} />
      <GroupMemberEntries members={members} />
    </div>
  );
}
