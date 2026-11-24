import { ChatDensity } from "@/components/charts/chat-density";
import { ChartFrame } from "@/components/charts/chart-frame";
import { TenMinuteBars } from "@/components/charts/ten-minute-bars";
import { DataEmpty } from "@/components/dashboard/primitives/data-empty";
import { type MetricItem, MetricStrip } from "@/components/dashboard/primitives/metric-strip";
import { StreamDescription } from "@/components/dashboard/stream/stream-description";
import type { StreamRow } from "@/lib/aggregate";
import {
  chatUnavailableCopy,
  resolveChatAvailability,
} from "@/lib/data-availability";
import {
  formatDateTimeSeconds,
  formatDuration,
  formatInteger,
  formatPercent,
} from "@/lib/format";
import type { StreamDatapack } from "@/types/datapack";

interface StreamOverviewPanelProps {
  row: StreamRow;
}

export function StreamOverviewPanel({ row }: StreamOverviewPanelProps) {
  const { pack, summary } = row;
  const vstats = pack.vstats;
  const density = pack.chat.density;
  const superchatCount = pack.chat.paid.superchats.length;
  const availability = resolveChatAvailability({
    availability: pack.video.availability,
    hasLiveChatReplay: pack.video.hasLiveChatReplay,
    liveStatus: pack.video.liveStatus,
    total: pack.chat.total,
  });
  const chatAvailable = availability.state === "available";
  const emptyCopy =
    availability.state === "unavailable" ? chatUnavailableCopy(availability.reason) : null;

  const items: MetricItem[] = [
    {
      label: "平均 / 最大同接",
      value: `${formatInteger(vstats?.avgConcurrent ?? null)} / ${formatInteger(vstats?.maxConcurrent ?? null)}`,
      hint: vstats?.maxConcurrentAt ? `峰值于 ${vstats.maxConcurrentAt}` : "VSTATS 未收录",
    },
    {
      label: "视听时间",
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
      unit: chatAvailable ? "条" : undefined,
      value: chatAvailable ? formatInteger(pack.chat.total) : "—",
      hint: chatAvailable ? `${density.perMinuteMean?.toFixed(1) ?? "—"} 条/分` : emptyCopy?.message,
    },
    {
      label: "发言人数",
      unit: chatAvailable ? "人" : undefined,
      value: chatAvailable ? formatInteger(pack.chat.uniqueAuthors) : "—",
      hint: chatAvailable ? `付费占比 ${formatPercent(pack.chat.paid.paidSharePct)}` : undefined,
    },
    {
      label: "SC",
      unit: chatAvailable ? "笔" : undefined,
      value: chatAvailable ? formatInteger(superchatCount) : "—",
      hint: chatAvailable ? `${pack.derived.scPerHour?.toFixed(2) ?? "—"} 笔/小时` : undefined,
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

      {/* 没有弹幕时不画两张空图：用一条带原因的说明代替，把版面留给下面的视频信息。 */}
      {chatAvailable ? (
        <>
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
        </>
      ) : (
        <section className="border-t border-hairline pt-5">
          <DataEmpty
            hint={emptyCopy?.hint}
            message={emptyCopy?.message ?? "这场没有弹幕数据"}
          />
        </section>
      )}

      <StreamInfoSection pack={pack} videoId={summary.videoId} />
    </div>
  );
}

interface StreamInfoSectionProps {
  pack: StreamDatapack;
  videoId: string;
}

/**
 * 视频信息：来源频道、发布时刻、简介、章节与外链。
 *
 * 默认展开——没有弹幕的场次里，这些是页面上唯一能回答「这场是什么」的内容。
 */
function StreamInfoSection({ pack, videoId }: StreamInfoSectionProps) {
  const video = pack.video;
  const { chapters, description, links } = video;
  const hasChapters = chapters.length > 0;
  const hasDescription = Boolean(description) || links.length > 0;
  const hasSource = Boolean(video.channelName) || Boolean(video.channelUrl);

  if (!hasDescription && !hasChapters && !hasSource) return null;

  return (
    <details className="border-t border-hairline pt-4" open>
      <summary className="cursor-pointer text-footnote font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink">
        视频信息
        <span className="ms-2 font-normal text-ink-3 tabular-nums">
          {videoId}
          {description ? ` · 简介 ${description.length} 字` : ""}
          {!description && links.length > 0 ? ` · 链接 ${links.length}` : ""}
          {hasChapters ? ` · 章节 ${chapters.length}` : ""}
        </span>
      </summary>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {video.channelName ? (
          <div className="flex min-w-0 items-baseline gap-2">
            <dt className="shrink-0 text-caption text-muted-foreground">频道</dt>
            <dd className="min-w-0 truncate text-footnote text-foreground">
              {video.channelUrl ? (
                <a
                  className="underline decoration-hairline underline-offset-2 hover:decoration-current"
                  href={video.channelUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {video.channelName}
                </a>
              ) : (
                video.channelName
              )}
            </dd>
          </div>
        ) : null}

        {video.channelFollowersAtCapture != null ? (
          <InfoRow
            label="抓取时订阅"
            value={`${formatInteger(video.channelFollowersAtCapture)} 人`}
          />
        ) : null}

        {video.publishedAt ? (
          <InfoRow label="发布时刻" value={`${formatDateTimeSeconds(video.publishedAt)} JST`} />
        ) : null}

        {video.durationSec != null ? (
          <InfoRow label="时长" value={formatDuration(video.durationSec)} />
        ) : null}

        <InfoRow label="日语字幕" value={video.captionsJa ? "有" : "无"} />
      </dl>

      {hasDescription ? (
        <div className="mt-4">
          <StreamDescription description={description} links={links} />
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="shrink-0 text-caption text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-footnote tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
