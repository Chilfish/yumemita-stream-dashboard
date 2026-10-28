import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { CopyLinkButton } from "@/components/dashboard/copy-link-button";
import { PageHeader } from "@/components/dashboard/page-header";
import { Panel } from "@/components/dashboard/panel";
import { StreamCommentsPanel } from "@/components/dashboard/stream-comments-panel";
import { StreamOverviewPanel } from "@/components/dashboard/stream-overview-panel";
import { StreamPaidPanel } from "@/components/dashboard/stream-paid-panel";
import { StreamTimelinePanel } from "@/components/dashboard/stream-timeline-panel";
import { StreamWordsPanel } from "@/components/dashboard/stream-words-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import type { StreamRow } from "@/lib/aggregate";
import {
  formatDuration,
  formatDurationLong,
  formatFullDate,
  formatInteger,
  formatTime,
  formatWeekday,
} from "@/lib/format";
import { STREAM_SUBVIEWS, type StreamSubView } from "@/lib/routes";
import type { StreamSummary } from "@/types/dataset";

const SUBVIEW_LABELS: Record<StreamSubView, string> = {
  overview: "概览",
  timeline: "时间轴",
  words: "弹幕与词",
  paid: "付费",
  comments: "评论",
};

interface StreamDetailViewProps {
  rows: StreamSummary[];
  row: StreamRow;
  view: StreamSubView;
  onViewChange: (view: StreamSubView) => void;
  onSelect: (videoId: string) => void;
}

function renderSubview(view: StreamSubView, row: StreamRow): ReactNode {
  switch (view) {
    case "timeline":
      return <StreamTimelinePanel row={row} />;
    case "words":
      return <StreamWordsPanel row={row} />;
    case "paid":
      return <StreamPaidPanel row={row} />;
    case "comments":
      return <StreamCommentsPanel row={row} />;
    case "overview":
    default:
      return <StreamOverviewPanel row={row} />;
  }
}

export function StreamDetailView({
  rows,
  row,
  view,
  onViewChange,
  onSelect,
}: StreamDetailViewProps) {
  const { pack, summary } = row;
  const memberOnly = pack.video.availability === "subscriber_only";
  const missingVstats = pack.vstats == null;
  const superchatCount = pack.chat.paid.superchats.length;

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
        eyebrow={`${formatFullDate(summary.startedAt)} ${formatWeekday(summary.startedAt)} · ${formatTime(summary.startedAt)}–${formatTime(summary.endedAt)} JST`}
        facts={[
          { label: "时长", value: formatDuration(summary.durationSec) },
          { label: "平均同接", value: formatInteger(pack.vstats?.avgConcurrent ?? null) },
          { label: "峰值", value: formatInteger(pack.vstats?.maxConcurrent ?? null) },
          { label: "弹幕", value: formatInteger(pack.chat.total) },
          { label: "SC", value: `${formatInteger(superchatCount)} 笔` },
          { label: "评论", value: formatInteger(pack.comments?.total ?? null) },
        ]}
        title={summary.title}
        titleClassName="text-title line-clamp-2"
      >
        {memberOnly || missingVstats ? (
          <span className="flex flex-wrap items-center gap-1.5">
            {memberOnly ? <Badge variant="warning">会员限定</Badge> : null}
            {missingVstats ? (
              <Badge title="没有 VSTATS 同接快照，同接与视聴时间为空" variant="outline">
                数据缺失
              </Badge>
            ) : null}
          </span>
        ) : null}
      </PageHeader>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl aria-label="单场子视图" onKeyDown={handleSegmentedKeyDown}>
          {STREAM_SUBVIEWS.map(subview => (
            <SegmentedControlItem
              aria-current={subview === view ? "page" : undefined}
              key={subview}
              onClick={() => onViewChange(subview)}
            >
              {SUBVIEW_LABELS[subview]}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>

        {rows.length > 1 ? (
          <nav aria-label="切换场次" className="flex items-center gap-1">
            <Button
              aria-label={newer ? `较新一场：${newer.title}` : "没有较新的场次"}
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
              aria-label={older ? `较早一场：${older.title}` : "没有较早的场次"}
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

      <Panel className="p-4 md:p-5">{renderSubview(view, row)}</Panel>

      <p className="text-caption text-ink-3">
        本场时长 {formatDurationLong(summary.durationSec)}；数据包生成于 {pack.generatedAt}；
        videoId {summary.videoId}。
      </p>
    </div>
  );
}
