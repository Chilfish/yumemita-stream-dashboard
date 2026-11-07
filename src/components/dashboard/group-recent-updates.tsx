import { useMemo, useState, type CSSProperties } from "react";
import { Link } from "@/lib/router-compat";
import { Sparkline } from "@/components/charts/sparkline";
import { MemberDot } from "@/components/dashboard/member-avatar";
import { Panel, PanelBody, PanelHead } from "@/components/dashboard/panel";
import { StreamCover } from "@/components/dashboard/stream-cover";
import { Button } from "@/components/ui/button";
import { formatDate, formatDecimal, formatInteger, formatTime } from "@/lib/format";
import type { GroupStreamRow } from "@/lib/group";
import {
  buildRecentTrend,
  primaryReadout,
  RECENT_UPDATE_LIMIT,
  recentUpdates,
} from "@/lib/group-home";
import { streamPath } from "@/lib/routes";
import { isMemberOnly } from "@/lib/visibility";
import { GROUP_RECENT_LIMIT } from "@/types/group";

interface GroupRecentUpdatesProps {
  rows: GroupStreamRow[];
}

/** 跨成员的最近更新：一行一场，成员名 + 封面 + 日期 + 标题 + 一个读数。 */
export function GroupRecentUpdates({ rows }: GroupRecentUpdatesProps) {
  const [showAll, setShowAll] = useState(false);
  const trend = useMemo(() => buildRecentTrend(rows, GROUP_RECENT_LIMIT), [rows]);
  const recent = recentUpdates(rows, showAll ? rows.length : RECENT_UPDATE_LIMIT);
  const peakIndex =
    trend.length > 0
      ? trend.reduce(
          (best, point, index) => (point.value > (trend[best]?.value ?? 0) ? index : best),
          0,
        )
      : -1;
  const peak = peakIndex >= 0 ? trend[peakIndex] ?? null : null;

  return (
    <Panel>
      <PanelHead
        actions={
          rows.length > RECENT_UPDATE_LIMIT ? (
            <Button
              aria-controls="group-recent-list"
              aria-expanded={showAll}
              onClick={() => setShowAll(value => !value)}
              size="xs"
              variant="ghost"
            >
              {showAll ? "收起" : `全部 ${rows.length} 条`}
            </Button>
          ) : undefined
        }
        meta={`全组最新 ${recent.length} 场，按开播时间倒序`}
        title="最近更新"
      />
      <PanelBody flush>
        {trend.length > 1 ? (
          <div className="border-t border-hairline px-5 pt-3 pb-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className="text-caption text-ink-3">
                近 {trend.length} 场 · 每分钟弹幕（不含会员限定）
              </p>
              {peak ? (
                <p className="text-caption text-ink-3 tabular-nums">
                  峰值 {formatDate(peak.startedAt)} · {formatDecimal(peak.value)} 条/分
                </p>
              ) : null}
            </div>
            <Sparkline
              area
              ariaLabel={`近 ${trend.length} 场每分钟弹幕趋势`}
              color="var(--chart-1)"
              height={64}
              peakIndex={peakIndex}
              values={trend.map(point => point.value)}
            />
          </div>
        ) : null}
        {recent.length === 0 ? (
          <p className="border-t border-hairline px-5 py-8 text-center text-footnote text-muted-foreground">
            还没有可以列出的场次。
          </p>
        ) : (
          <ul
            className="divide-y divide-hairline border-t border-hairline"
            id="group-recent-list"
          >
            {recent.map(row => {
              const readout = primaryReadout(row);
              const memberOnly = isMemberOnly(row.availability);

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
                          {memberOnly
                            ? <span className="text-ink-3">会员限定</span>
                            : (
                                <>
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
