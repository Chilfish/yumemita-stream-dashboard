import type { CSSProperties } from "react";
import { Link } from "react-router";
import { MemberAvatar, MemberDot } from "@/components/dashboard/member-avatar";
import { StreamCover } from "@/components/dashboard/stream-cover";
import { formatDate, formatInteger, formatTime } from "@/lib/format";
import type { GroupMemberSummary } from "@/lib/group";
import {
  memberAccentColor,
  primaryReadout,
  relativeDayLabel,
  secondaryReadout,
} from "@/lib/group-home";
import { homePath, streamPath } from "@/lib/routes";

interface InlineValueProps {
  label: string;
  unit: string;
  value: number | null;
}

function InlineValue({ label, unit, value }: InlineValueProps) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-ink-3">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{formatInteger(value)}</span>
      {value == null ? null : <span className="text-caption text-ink-3">{unit}</span>}
    </span>
  );
}

interface GroupMemberRowProps {
  member: GroupMemberSummary;
}

/**
 * hero 里的次级成员：一个小缩略图 + 完整换行的标题 + 两个数字。
 * 没有场次时只留一句「还没有场次」，不画空封面。
 */
export function GroupMemberRow({ member }: GroupMemberRowProps) {
  const color = memberAccentColor(member);
  const stream = member.latest;
  const relative = stream ? relativeDayLabel(stream.startedAt) : null;
  const primary = stream ? primaryReadout(stream) : null;
  const secondary = stream ? secondaryReadout(stream) : null;

  return (
    <li
      className="min-w-0 py-3 first:pt-0 last:pb-0"
      style={{ "--member-color": color } as CSSProperties}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Link
          className="flex min-w-0 items-center gap-1.5 rounded-control text-caption text-muted-foreground transition-colors duration-120 ease-out hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink"
          to={homePath(member.dataset.id)}
        >
          <MemberAvatar
            avatar={member.dataset.avatar}
            className="size-5"
            color={color}
            label={member.dataset.label}
          />
          <MemberDot color={color} />
          <span className="block min-w-0 font-medium text-foreground">
            {member.dataset.label}
          </span>
          <span className="sr-only">的成员首页</span>
        </Link>
        {stream ? (
          <span className="ms-auto shrink-0 text-caption text-ink-3 tabular-nums">
            {formatDate(stream.startedAt)} {formatTime(stream.startedAt)}
            {relative ? <span className="text-muted-foreground"> · {relative}</span> : null}
          </span>
        ) : null}
      </div>

      {stream && primary && secondary ? (
        <Link
          className="group mt-1.5 flex min-w-0 items-start gap-2.5 rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink"
          to={streamPath(member.dataset.id, stream.videoId)}
        >
          <StreamCover
            className="w-14 shrink-0 [--cover-radius:6px] sm:w-16"
            datasetId={member.dataset.id}
            sizes="(min-width: 640px) 64px, 56px"
            thumbnail={stream.thumbnail}
            title={stream.title}
            videoId={stream.videoId}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-body text-foreground transition-colors duration-120 ease-out group-hover:text-member-ink">
              {stream.title}
            </span>
            <span className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-caption">
              <InlineValue label={primary.label} unit={primary.unit} value={primary.value} />
              <InlineValue label={secondary.label} unit={secondary.unit} value={secondary.value} />
            </span>
          </span>
        </Link>
      ) : (
        <p className="mt-1 text-caption text-ink-3">还没有场次</p>
      )}
    </li>
  );
}
