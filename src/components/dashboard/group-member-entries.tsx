import { Link } from "react-router";
import { MemberAvatar, MemberDot } from "@/components/dashboard/member-avatar";
import { formatDate, formatInteger } from "@/lib/format";
import { sortMembersByLatest, type GroupMemberSummary } from "@/lib/group";
import { memberAccentColor } from "@/lib/group-home";
import { groupGalleryPath, homePath } from "@/lib/routes";

interface GroupMemberEntriesProps {
  members: GroupMemberSummary[];
}

/** 页面底部的入口：全组相册 + 每位成员的首页，安静的两列/三列文字表。 */
export function GroupMemberEntries({ members }: GroupMemberEntriesProps) {
  const sorted = sortMembersByLatest(members);

  return (
    <section aria-labelledby="group-entries-heading" className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-headline text-foreground" id="group-entries-heading">
          按成员进入
        </h2>
        <Link
          className="text-footnote text-muted-foreground underline-offset-4 transition-colors duration-120 ease-out hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink"
          to={groupGalleryPath()}
        >
          全组相册 →
        </Link>
      </div>

      <ul className="mt-2 grid grid-cols-1 gap-x-6 border-t border-hairline sm:grid-cols-2 xl:grid-cols-3">
        {sorted.map(member => {
          const color = memberAccentColor(member);

          return (
            <li className="min-w-0 border-b border-hairline" key={member.dataset.id}>
              <Link
                className="flex min-h-11 min-w-0 items-center gap-2.5 py-2 transition-colors duration-120 ease-out hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-member-ink"
                to={homePath(member.dataset.id)}
              >
                <MemberAvatar
                  avatar={member.dataset.avatar}
                  className="size-7"
                  color={color}
                  label={member.dataset.label}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5 text-body font-medium text-foreground">
                    <span className="min-w-0">{member.dataset.label}</span>
                    <MemberDot color={color} />
                  </span>
                  <span className="block text-caption text-ink-3 tabular-nums">
                    {member.latest
                      ? `最近 ${formatDate(member.latest.startedAt)} · 共 ${formatInteger(member.streamCount)} 场`
                      : "还没有场次"}
                  </span>
                </span>
                <span aria-hidden="true" className="shrink-0 text-caption text-ink-3">
                  →
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
