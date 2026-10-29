import type { CSSProperties } from "react";
import { Link } from "react-router";
import { MemberAvatar, MemberDot } from "@/components/dashboard/member-avatar";
import { StreamCover } from "@/components/dashboard/stream-cover";
import { Badge } from "@/components/ui/badge";
import {
  formatDate,
  formatDurationLong,
  formatInteger,
  formatTime,
  formatWeekday,
} from "@/lib/format";
import type { GroupMemberSummary } from "@/lib/group";
import {
  memberAccentColor,
  primaryReadout,
  relativeDayLabel,
  secondaryReadout,
} from "@/lib/group-home";
import { homePath, streamPath } from "@/lib/routes";
import type { StreamSummary } from "@/types/dataset";

const LINK_CLASS =
  "text-footnote text-muted-foreground underline-offset-4 transition-colors duration-120 ease-out hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink";

interface ReadoutProps {
  label: string;
  value: string;
  unit?: string;
}

/** 主视觉的读数：数字 600、同族等宽，单位降一级，标签在下方。 */
function Readout({ label, value, unit }: ReadoutProps) {
  return (
    <div className="min-w-0">
      <p className="flex items-baseline text-stat-sm tabular-nums text-foreground">
        <span className="min-w-0">{value}</span>
        {unit ? (
          <span className="ml-1 shrink-0 text-caption font-medium text-ink-3">{unit}</span>
        ) : null}
      </p>
      <p className="mt-0.5 text-caption text-muted-foreground">{label}</p>
    </div>
  );
}

interface GroupFocusStreamProps {
  member: GroupMemberSummary;
  stream: StreamSummary;
}

/**
 * 全组最新一场：页面上唯一的大封面 + 最大标题，用来说明「最近谁播了」。
 * 标题完整换行，不截断；两个数字之外的信息压到一行元信息里。
 */
export function GroupFocusStream({ member, stream }: GroupFocusStreamProps) {
  const color = memberAccentColor(member);
  const primary = primaryReadout(stream);
  const secondary = secondaryReadout(stream);
  const relative = relativeDayLabel(stream.startedAt);
  const memberOnly = stream.availability === "subscriber_only";

  return (
    <section
      aria-label={`全组最新一场：${member.dataset.label}`}
      className="flex min-w-0 flex-col px-5 pt-4 pb-5"
      style={{ "--member-color": color } as CSSProperties}
    >
      <div className="mb-3 max-w-[34rem]">
        <StreamCover
          datasetId={member.dataset.id}
          eager
          sizes="(min-width: 1024px) 46vw, 100vw"
          thumbnail={stream.thumbnail}
          title={stream.title}
          videoId={stream.videoId}
        />
      </div>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption">
        <MemberAvatar
          avatar={member.dataset.avatar}
          className="size-5"
          color={color}
          label={member.dataset.label}
        />
        <MemberDot color={color} />
        <span className="font-medium text-foreground">{member.dataset.label}</span>
        <span className="text-muted-foreground">全组最新一场</span>
        <span className="tabular-nums text-ink-3">
          {formatDate(stream.startedAt)} {formatWeekday(stream.startedAt)}{" "}
          {formatTime(stream.startedAt)}
        </span>
        {relative ? <span className="text-muted-foreground tabular-nums">· {relative}</span> : null}
      </p>

      <h2 className="mt-1.5 text-title text-foreground">
        <Link
          className="transition-colors duration-120 ease-out hover:text-member-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink"
          to={streamPath(member.dataset.id, stream.videoId)}
        >
          {stream.title}
        </Link>
      </h2>

      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
        <span className="tabular-nums">
          播放 {formatInteger(stream.vstatsViews ?? stream.snapshotViews)}
        </span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">SC {formatInteger(stream.superchats)} 笔</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">平均同接 {formatInteger(stream.avgConcurrent)}</span>
        {memberOnly ? (
          <>
            <span aria-hidden="true">·</span>
            <Badge size="sm" variant="outline">
              会员限定
            </Badge>
          </>
        ) : null}
      </p>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-3">
        <Readout
          label={primary.label}
          unit={primary.value == null ? undefined : primary.unit}
          value={formatInteger(primary.value)}
        />
        <Readout
          label={secondary.label}
          unit={secondary.value == null ? undefined : secondary.unit}
          value={formatInteger(secondary.value)}
        />
        <Readout label="时长" value={formatDurationLong(stream.durationSec)} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link className={LINK_CLASS} to={streamPath(member.dataset.id, stream.videoId)}>
          单场详情 →
        </Link>
        <Link className={LINK_CLASS} to={homePath(member.dataset.id)}>
          进入 {member.dataset.label} 的首页 →
        </Link>
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline pt-2.5 text-caption text-ink-3 tabular-nums">
        <span>全期 {formatInteger(member.streamCount)} 场</span>
        <span aria-hidden="true">·</span>
        <span>近 7 天 {formatInteger(member.weekStreams)} 场</span>
        <span aria-hidden="true">·</span>
        <span>弹幕 {formatInteger(member.chatTotal)} 条</span>
      </p>
    </section>
  );
}
