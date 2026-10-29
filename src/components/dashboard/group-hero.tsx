import { GroupFocusStream } from "@/components/dashboard/group-focus-stream";
import { GroupMemberRow } from "@/components/dashboard/group-member-row";
import { GroupWeekActivity } from "@/components/dashboard/group-week-activity";
import { Panel } from "@/components/dashboard/panel";
import type { GroupMemberSummary } from "@/lib/group";
import { splitHeroMembers } from "@/lib/group-home";
import { cn } from "@/lib/utils";

interface GroupHeroProps {
  members: GroupMemberSummary[];
}

/**
 * 首屏主视觉：最近一场独占大封面与大标题，其余成员退回右侧/下方的安静列表。
 * 没有场次的成员只留一行「还没有场次」，不生成等重的假卡片。
 */
export function GroupHero({ members }: GroupHeroProps) {
  const { focus, rest } = splitHeroMembers(members);
  const focusStream = focus?.latest ?? null;

  return (
    <Panel>
      {focus && focusStream ? (
        <div
          className={cn(
            "grid grid-cols-1 divide-y divide-hairline",
            rest.length > 0 &&
              "lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0",
          )}
        >
          <GroupFocusStream member={focus} stream={focusStream} />

          {rest.length > 0 ? (
            <section aria-labelledby="group-rest-heading" className="min-w-0 px-5 pt-4 pb-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <h3 className="text-caption text-ink-3" id="group-rest-heading">
                  其他成员
                </h3>
                <p className="text-caption text-ink-3">按最近更新排序</p>
              </div>
              <ul className="mt-2 divide-y divide-hairline">
                {rest.map(member => (
                  <GroupMemberRow key={member.dataset.id} member={member} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : (
        <div className="px-5 py-10">
          <h2 className="text-title text-foreground">还没有抓到任何场次</h2>
        </div>
      )}

      <GroupWeekActivity members={members} />
    </Panel>
  );
}
