import type { CSSProperties } from "react";
import { Link } from "react-router";
import { MemberDot } from "@/components/dashboard/member-avatar";
import { Panel, PanelBody, PanelHead } from "@/components/dashboard/panel";
import { StreamCover } from "@/components/dashboard/stream-cover";
import { formatDate, formatInteger, formatTime } from "@/lib/format";
import type { GroupStreamRow } from "@/lib/group";
import { primaryReadout, recentUpdates } from "@/lib/group-home";
import { streamPath } from "@/lib/routes";

interface GroupRecentUpdatesProps {
  rows: GroupStreamRow[];
}

/** 跨成员的最近更新：一行一场，成员名 + 封面 + 日期 + 标题 + 一个读数。 */
export function GroupRecentUpdates({ rows }: GroupRecentUpdatesProps) {
  const recent = recentUpdates(rows);

  return (
    <Panel>
      <PanelHead meta={`全组最新 ${recent.length} 场，按开播时间倒序`} title="最近更新" />
      <PanelBody flush>
        {recent.length === 0 ? (
          <p className="border-t border-hairline px-5 py-8 text-center text-footnote text-muted-foreground">
            还没有可以列出的场次。
          </p>
        ) : (
          <ul className="divide-y divide-hairline border-t border-hairline">
            {recent.map(row => {
              const readout = primaryReadout(row);

              return (
                <li key={`${row.datasetId}-${row.videoId}`}>
                  <Link
                    className="group flex min-w-0 items-start gap-3 px-5 py-2.5 transition-colors duration-120 ease-out active:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-member-ink"
                    style={{ "--member-color": row.memberColor } as CSSProperties}
                    to={streamPath(row.datasetId, row.videoId)}
                  >
                    <StreamCover
                      className="w-16 shrink-0 [--cover-radius:6px] sm:w-20"
                      datasetId={row.datasetId}
                      sizes="(min-width: 640px) 80px, 64px"
                      thumbnail={row.thumbnail}
                      title={row.title}
                      videoId={row.videoId}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-ink-3">
                        <MemberDot color={row.memberColor} />
                        <span className="font-medium text-muted-foreground">{row.memberLabel}</span>
                        <span className="tabular-nums">
                          {formatDate(row.startedAt)} {formatTime(row.startedAt)}
                        </span>
                        <span className="ms-auto shrink-0 tabular-nums">
                          <span className="text-ink-3">{readout.label}</span>{" "}
                          <span className="font-medium text-foreground">
                            {formatInteger(readout.value)}
                          </span>
                          {readout.value == null ? null : (
                            <>
                              {" "}
                              <span className="text-ink-3">{readout.unit}</span>
                            </>
                          )}
                        </span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-body text-foreground transition-colors duration-120 ease-out group-hover:text-member-ink">
                        {row.title}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}
