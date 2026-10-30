import { Link } from "react-router";
import { Sparkline } from "@/components/charts/sparkline";
import { StreamCover } from "@/components/dashboard/stream-cover";
import { Badge } from "@/components/ui/badge";
import {
  formatDate,
  formatDecimal,
  formatDurationLong,
  formatInteger,
  formatTime,
  formatWeekday,
} from "@/lib/format";
import { streamPath } from "@/lib/routes";
import type { StreamSummary } from "@/types/dataset";

const SPARK_STREAMS = 12;

interface HomeLatestStreamProps {
  datasetId: string;
  stream: StreamSummary;
  rows: StreamSummary[];
}

function chatPerMinute(row: StreamSummary): number {
  if (!row.durationSec || row.durationSec <= 0) return 0;
  return row.chatTotal / (row.durationSec / 60);
}

export function HomeLatestStream({ datasetId, stream, rows }: HomeLatestStreamProps) {
  const recent = rows.slice(0, SPARK_STREAMS).reverse();
  const rates = recent.map(chatPerMinute);
  const peakIndex = rates.length > 0 ? rates.indexOf(Math.max(...rates)) : -1;
  const peakRow = peakIndex >= 0 ? recent[peakIndex] : null;
  const memberOnly = stream.availability === "subscriber_only";

  const primary = [
    { label: "弹幕", unit: "条", value: formatInteger(stream.chatTotal) },
    { label: "平均同接", value: formatInteger(stream.avgConcurrent) },
    { label: "峰值同接", value: formatInteger(stream.maxConcurrent) },
  ];

  const secondary = [
    `播放 ${formatInteger(stream.vstatsViews ?? stream.snapshotViews)}`,
    `SC ${formatInteger(stream.superchats)} 笔`,
    `评论 ${formatInteger(stream.commentsCaptured)} 条`,
  ];

  return (
    <div className="flex min-w-0 flex-col px-5 pt-4 pb-5">
      {/* 首屏唯一的大图：手机与桌面都占满左栏单元格。
          图片本身不是链接——下面的标题已经可达，避免重复的链接与空的链接名。 */}
      <div className="mb-3">
        <StreamCover
          datasetId={datasetId}
          eager
          sizes="(min-width: 1024px) 60vw, 100vw"
          thumbnail={stream.thumbnail}
          title={stream.title}
          videoId={stream.videoId}
        />
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <p className="flex min-w-0 items-center gap-1.5 text-caption text-member-ink">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-member" />
          <span className="truncate">最近一场 · {formatDate(stream.startedAt)}</span>
        </p>
        <Link
          className="-my-1 flex min-h-9 shrink-0 items-center text-caption text-muted-foreground transition-colors duration-120 ease-out hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink"
          to={streamPath(datasetId, stream.videoId)}
        >
          打开单场详情 →
        </Link>
      </div>

      <h2 className="mt-2 text-title text-foreground">
        <Link
          className="line-clamp-3 transition-colors duration-120 ease-out hover:text-member-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink md:line-clamp-2"
          to={streamPath(datasetId, stream.videoId)}
        >
          {stream.title}
        </Link>
      </h2>

      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
        <span className="tabular-nums">
          {formatWeekday(stream.startedAt)} · {formatTime(stream.startedAt)} 开播
        </span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{formatDurationLong(stream.durationSec)}</span>
        {memberOnly ? (
          <>
            <span aria-hidden="true">·</span>
            <Badge size="sm" variant="outline">
              会员限定
            </Badge>
          </>
        ) : null}
      </div>

      <div className="mt-5 grid grid-cols-3">
        {primary.map(item => (
          <div
            className={"min-w-0 border-s border-hairline px-3"}
            key={item.label}
          >
            <p className="flex items-baseline text-stat tabular-nums text-foreground">
              <span className="min-w-0 truncate">{item.value}</span>
              {item.unit ? (
                <span className="ml-1 shrink-0 text-caption font-medium text-ink-3">
                  {item.unit}
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 text-caption text-muted-foreground">{item.label}</p>
          </div>
        ))}
      </div>

      <p className="mt-2 text-caption text-muted-foreground tabular-nums">
        {secondary.join(" · ")}
      </p>

      {rates.length > 1 ? (
        <div className="mt-5 border-t border-hairline pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-caption text-ink-3">近 {rates.length} 场 · 每分钟弹幕</p>
            {peakRow ? (
              <p className="text-caption text-ink-3 tabular-nums">
                峰值 {formatDate(peakRow.startedAt)} · {formatDecimal(rates[peakIndex])} 条/分
              </p>
            ) : null}
          </div>
          <Sparkline
            area
            ariaLabel="最近 12 场每分钟弹幕趋势"
            height={72}
            peakIndex={peakIndex >= 0 ? peakIndex : undefined}
            values={rates}
          />
        </div>
      ) : null}
    </div>
  );
}
