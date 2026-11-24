import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { CopyLinkButton } from "@/components/dashboard/primitives/copy-link-button";
import { PageHeader } from "@/components/dashboard/primitives/page-header";
import { Panel } from "@/components/dashboard/primitives/panel";
import { StreamCommentsPanel } from "@/components/dashboard/stream/stream-comments-panel";
import { StreamOverviewPanel } from "@/components/dashboard/stream/stream-overview-panel";
import { StreamPaidPanel } from "@/components/dashboard/stream/stream-paid-panel";
import { StreamCover } from "@/components/dashboard/primitives/stream-cover";
import { StreamTimelinePanel } from "@/components/dashboard/stream/stream-timeline-panel";
import { StreamWordsPanel } from "@/components/dashboard/stream/stream-words-panel";
import { TranscriptView } from "@/components/dashboard/transcript/transcript-view";
import type { TranscriptFile } from "@/lib/transcripts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import type { StreamRow } from "@/lib/aggregate";
import {
  formatDuration,
  formatFullDate,
  formatInteger,
  formatTime,
  formatWeekday,
} from "@/lib/format";
import { STREAM_SUBVIEWS, type StreamSubView } from "@/lib/routes";
import { resolveChatAvailability } from "@/lib/data-availability";
import type { StreamNavItem } from "@/types/dataset";

const SUBVIEW_LABELS: Record<StreamSubView, string> = {
  overview: "概览",
  timeline: "时间轴",
  words: "弹幕与词",
  paid: "付费",
  comments: "评论",
  transcript: "逐字稿",
};

interface StreamDetailViewProps {
  datasetId: string;
  /** 联动场的全部成员标签，频道主在前；单人场只有一项。 */
  memberLabels: string[];
  rows: StreamNavItem[];
  row: StreamRow;
  view: StreamSubView;
  onViewChange: (view: StreamSubView) => void;
  onSelect: (videoId: string) => void;
  hasTranscript: boolean;
  /** 服务端预渲染的逐字稿正文；只在首屏就是这一场的逐字稿时才有值。 */
  initialTranscript?: TranscriptFile | null;
}

function renderSubview(
  view: StreamSubView,
  row: StreamRow,
  datasetId: string,
  initialTranscript: TranscriptFile | null,
): ReactNode {
  switch (view) {
    case "timeline":
      return <StreamTimelinePanel row={row} />;
    case "words":
      return <StreamWordsPanel datasetId={datasetId} row={row} />;
    case "paid":
      return <StreamPaidPanel datasetId={datasetId} row={row} />;
    case "comments":
      return <StreamCommentsPanel row={row} />;
    case "transcript":
      return (
        <TranscriptView
          datasetId={datasetId}
          initialFile={initialTranscript}
          videoId={row.summary.videoId}
        />
      );
    case "overview":
    default:
      return <StreamOverviewPanel row={row} />;
  }
}

export function StreamDetailView({
  datasetId,
  memberLabels,
  rows,
  row,
  view,
  onViewChange,
  onSelect,
  hasTranscript: hasTranscriptProp,
  initialTranscript,
}: StreamDetailViewProps) {
  const { pack, summary } = row;
  // 预渲染的正文只属于首屏那一场；换了场次就退回客户端加载。
  const transcriptFile =
    initialTranscript && initialTranscript.videoId === summary.videoId ? initialTranscript : null;
  const memberOnly = pack.video.availability === "subscriber_only";
  const superchatCount = pack.chat.paid.superchats.length;
  // 联动场把全部成员写在一行；单人场为空，页头不额外占用一行。
  const memberLine = memberLabels.length > 1 ? memberLabels.join(" × ") : null;

  const chatAvailability = resolveChatAvailability({
    availability: pack.video.availability,
    hasLiveChatReplay: pack.video.hasLiveChatReplay,
    liveStatus: pack.video.liveStatus,
    total: pack.chat.total,
  });
  const chatAvailable = chatAvailability.state === "available";
  // 投稿没有开播/结束的时段，只写发布时刻。
  const isPublished = pack.video.liveStatus === "not_live";
  // 没有 VSTATS 时不留两个「—」占住位置：换成抓取时的播放与点赞快照。
  const vstats = pack.vstats;
  const chatTotal = chatAvailable ? formatInteger(pack.chat.total) : "—";
  const superchatValue = chatAvailable ? `${formatInteger(superchatCount)} 笔` : "—";
  // 评论优先用本站抓到的条数；没抓到但有 YouTube 总数时标出口径。
  const commentsTotal = pack.comments?.total ?? null;
  const commentsValue = commentsTotal != null
    ? formatInteger(commentsTotal)
    : formatInteger(pack.video.snapshot.comments);
  const facts = vstats
    ? [
        { label: "时长", value: formatDuration(summary.durationSec) },
        { label: "平均同接", value: formatInteger(vstats.avgConcurrent ?? null) },
        { label: "峰值", value: formatInteger(vstats.maxConcurrent ?? null) },
        { label: "弹幕", value: chatTotal },
        { label: "SC", value: superchatValue },
        {
          label: commentsTotal != null ? "评论" : "YouTube 评论",
          value: commentsValue,
        },
      ]
    : [
        { label: "时长", value: formatDuration(summary.durationSec) },
        { label: "播放", value: formatInteger(pack.video.snapshot.views) },
        { label: "点赞", value: formatInteger(pack.video.snapshot.likes) },
        { label: "弹幕", value: chatTotal },
        { label: "SC", value: superchatValue },
        {
          label: commentsTotal != null ? "评论" : "YouTube 评论",
          value: commentsValue,
        },
      ];

  // 逐字稿是可选内容：没有稿的场次不显示这个分段，避免出现永远为空的标签。
  const subviews = STREAM_SUBVIEWS.filter(subview => subview !== "transcript" || hasTranscriptProp);
  // URL 里的 view 可能指向当前不可用的分段（例如无稿时的 transcript）；回退到概览。
  const activeView = subviews.includes(view) ? view : "overview";

  const currentIndex = rows.findIndex(item => item.videoId === summary.videoId);
  const newer = currentIndex > 0 ? rows[currentIndex - 1] : undefined;
  const older =
    currentIndex >= 0 && currentIndex < rows.length - 1 ? rows[currentIndex + 1] : undefined;

  // 分段控件是按钮组：方向键在项目间移动焦点，Enter/Space 切换视图。
  function handleSegmentedKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;

    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[data-slot="segmented-control-item"]',
      ),
    );
    if (items.length === 0) return;
    event.preventDefault();

    const active = items.findIndex(item => item === document.activeElement);
    const step = event.key === "ArrowLeft" ? -1 : 1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : active < 0
            ? 0
            : (active + step + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 封面是这一屏的主视觉：桌面左置放大，移动端自然排在标题之前。 */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[28rem_minmax(0,1fr)] lg:items-start">
        <StreamCover
          datasetId={datasetId}
          eager
          sizes="(min-width: 1024px) 28rem, 100vw"
          thumbnail={summary.thumbnail}
          title={summary.title}
          videoId={summary.videoId}
        />

        <PageHeader
          actions={
            <>
              <CopyLinkButton />
              <Button
                render={<a href={summary.url} rel="noreferrer" target="_blank" />}
                size="sm"
                variant="outline"
              >
                <ExternalLink aria-hidden="true" />
                YouTube
              </Button>
            </>
          }
          className="min-w-0 border-b-0 pb-0 lg:border-b lg:pb-4"
          eyebrow={`${isPublished ? "发布" : "开播"} · ${formatFullDate(summary.startedAt)} ${formatWeekday(summary.startedAt)} · ${formatTime(summary.startedAt)}${isPublished ? "" : `–${formatTime(summary.endedAt)}`} JST`}
          facts={facts}
          title={summary.title}
          titleClassName="text-title line-clamp-2"
        >
          {memberLine || memberOnly ? (
            <span className="flex flex-wrap items-center gap-1.5">
              {memberLine ? <span className="text-footnote text-member-ink">{memberLine}</span> : null}
              {memberOnly ? <Badge variant="warning">会员限定</Badge> : null}
            </span>
          ) : null}
        </PageHeader>
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 max-w-full overflow-x-auto px-0.5 pb-0.5">
          <SegmentedControl aria-label="单场子视图" onKeyDown={handleSegmentedKeyDown}>
            {subviews.map(subview => (
              <SegmentedControlItem
                aria-current={subview === activeView ? "page" : undefined}
                key={subview}
                onClick={() => onViewChange(subview)}
              >
                {SUBVIEW_LABELS[subview]}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>

        {rows.length > 1 ? (
          <nav aria-label="切换场次" className="flex items-center gap-1">
            <Button
              aria-label={newer ? `较新：${newer.title}` : "没有较新的场次"}
              disabled={newer == null}
              onClick={() => newer && onSelect(newer.videoId)}
              size="xs"
              title={newer?.title}
              type="button"
              variant="ghost"
            >
              <ChevronLeft aria-hidden="true" />
              较新
            </Button>
            <Button
              aria-label={older ? `较早：${older.title}` : "没有较早的场次"}
              disabled={older == null}
              onClick={() => older && onSelect(older.videoId)}
              size="xs"
              title={older?.title}
              type="button"
              variant="ghost"
            >
              较早
              <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        ) : null}
      </div>

      <Panel className="p-4 md:p-5">
        {/* 子视图互换：只做 170ms 的淡入位移，高度跳变由淡入盖住。 */}
        <div className="motion-swap" key={activeView}>
          {renderSubview(activeView, row, datasetId, transcriptFile)}
        </div>
      </Panel>
    </div>
  );
}
