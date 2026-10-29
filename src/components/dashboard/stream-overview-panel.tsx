import { ChatDensity } from "@/components/charts/chat-density";
import { ChartFrame } from "@/components/charts/chart-frame";
import { TenMinuteBars } from "@/components/charts/ten-minute-bars";
import { type MetricItem, MetricStrip } from "@/components/dashboard/metric-strip";
import type { StreamRow } from "@/lib/aggregate";
import { formatDuration, formatInteger, formatPercent } from "@/lib/format";
import type { StreamDatapack } from "@/types/datapack";

interface StreamOverviewPanelProps {
  row: StreamRow;
}

export function StreamOverviewPanel({ row }: StreamOverviewPanelProps) {
  const { pack, summary } = row;
  const vstats = pack.vstats;
  const density = pack.chat.density;
  const superchatCount = pack.chat.paid.superchats.length;

  const items: MetricItem[] = [
    {
      label: "平均 / 最大同接",
      value: `${formatInteger(vstats?.avgConcurrent ?? null)} / ${formatInteger(vstats?.maxConcurrent ?? null)}`,
      hint: vstats?.maxConcurrentAt
        ? `峰值于 ${vstats.maxConcurrentAt}`
        : "无同接快照",
    },
    {
      label: "视聴时间",
      unit: "人·时",
      value: formatInteger(vstats?.watchTimeHours ?? null),
    },
    {
      label: "播放",
      value: formatInteger(vstats?.views ?? pack.video.snapshot.views),
      hint: `点赞率 ${formatPercent(
        pack.derived.likesPer1000Views != null ? pack.derived.likesPer1000Views / 10 : null,
        2,
      )}`,
    },
    {
      label: "点赞",
      value: formatInteger(vstats?.likes ?? pack.video.snapshot.likes),
    },
    {
      label: "弹幕",
      unit: "条",
      value: formatInteger(pack.chat.total),
      hint: `${density.perMinuteMean?.toFixed(1) ?? "—"} 条/分`,
    },
    {
      label: "发言人数",
      unit: "人",
      value: formatInteger(pack.chat.uniqueAuthors),
      hint: `付费占比 ${formatPercent(pack.chat.paid.paidSharePct)}`,
    },
    {
      label: "SC",
      unit: "笔",
      value: formatInteger(superchatCount),
      hint: `${pack.derived.scPerHour?.toFixed(2) ?? "—"} 笔/小时`,
    },
    {
      label: "评论",
      unit: "条",
      value: formatInteger(pack.comments?.total ?? null),
      hint: `置顶 ${pack.comments?.pinned ?? 0}`,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h2 className="sr-only">本场指标</h2>
        <MetricStrip columns={4} items={items} />
      </section>

      <section className="border-t border-hairline pt-5">
        <ChartFrame
          meta={`覆盖 ${pack.chat.coveragePct?.toFixed(1) ?? "—"}%`}
          title="逐分钟弹幕"
        >
          <ChatDensity row={row} />
        </ChartFrame>
      </section>

      <section className="border-t border-hairline pt-5">
        <ChartFrame title="每 10 分钟">
          <TenMinuteBars row={row} />
        </ChartFrame>
      </section>

      <StreamInfoSection pack={pack} videoId={summary.videoId} />
    </div>
  );
}

interface StreamInfoSectionProps {
  pack: StreamDatapack;
  videoId: string;
}

/** description / links / chapters 目前无独立「说明页」，收起在本场概览底部。 */
function StreamInfoSection({ pack, videoId }: StreamInfoSectionProps) {
  const { chapters, description, links } = pack.video;
  const hasLinks = links.length > 0;
  const hasChapters = chapters.length > 0;

  if (!description && !hasLinks && !hasChapters) return null;

  return (
    <details className="border-t border-hairline pt-4">
      <summary className="cursor-pointer text-footnote font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink">
        本场简介与链接
        <span className="ms-2 font-normal text-ink-3 tabular-nums">
          {videoId}
          {description ? ` · 简介 ${description.length} 字` : ""}
          {hasLinks ? ` · 链接 ${links.length}` : ""}
          {hasChapters ? ` · 章节 ${chapters.length}` : ""}
        </span>
      </summary>

      {description ? (
        <p className="mt-3 whitespace-pre-wrap text-footnote text-muted-foreground leading-relaxed">
          {description}
        </p>
      ) : null}

      {hasLinks ? (
        <div className="mt-4">
          <h3 className="text-caption text-muted-foreground">相关链接</h3>
          <ul className="mt-1 flex flex-col gap-0.5">
            {links.map(link => (
              <li className="min-w-0 truncate text-footnote" key={link}>
                <a
                  className="text-member-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink"
                  href={link}
                  rel="noreferrer"
                  target="_blank"
                >
                  {link}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasChapters ? (
        <div className="mt-4">
          <h3 className="text-caption text-muted-foreground">章节</h3>
          <ul className="mt-1 flex flex-col gap-0.5">
            {chapters.map((chapter, index) => (
              <li
                className="flex items-baseline gap-2 text-footnote"
                key={`${chapter.start_time ?? "chapter"}-${index}`}
              >
                <span className="shrink-0 tabular-nums text-ink-3">
                  {formatDuration(chapter.start_time ?? null)}
                </span>
                <span className="min-w-0 text-foreground">{chapter.title ?? "（无标题）"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </details>
  );
}
