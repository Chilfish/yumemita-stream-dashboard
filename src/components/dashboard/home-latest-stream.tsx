import { Link } from "react-router";
import { Sparkline } from "@/components/charts/sparkline";
import { MetricStrip, type MetricItem } from "@/components/dashboard/metric-strip";
import { Badge } from "@/components/ui/badge";
import type { DatasetTotals } from "@/lib/aggregate";
import {
  formatDate,
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
  totals: DatasetTotals;
}

function chatPerMinute(row: StreamSummary): number {
  if (!row.durationSec || row.durationSec <= 0) return 0;
  return row.chatTotal / (row.durationSec / 60);
}

export function HomeLatestStream({ datasetId, stream, rows, totals }: HomeLatestStreamProps) {
  const recent = rows.slice(0, SPARK_STREAMS).reverse();
  const rates = recent.map(chatPerMinute);
  const peakIndex = rates.length > 0 ? rates.indexOf(Math.max(...rates)) : undefined;
  const memberOnly = stream.availability === "subscriber_only";

  const metrics: MetricItem[] = [
    { label: "平均同接", value: formatInteger(stream.avgConcurrent) },
    { label: "峰值同接", value: formatInteger(stream.maxConcurrent) },
    { label: "弹幕", unit: "条", value: formatInteger(stream.chatTotal) },
    { label: "SC", unit: "笔", value: formatInteger(stream.superchats) },
    { label: "评论", unit: "条", value: formatInteger(stream.commentsCaptured) },
    { label: "播放", value: formatInteger(stream.vstatsViews ?? stream.snapshotViews) },
  ];

  const peak = totals.peakChatMinute;
  const bestSc = totals.bestBySc;

  return (
    <div className="flex min-w-0 flex-col px-5 pt-4 pb-5">
      <div className="flex items-start justify-between gap-3">
        <p className="flex min-w-0 items-center gap-1.5 text-caption text-member">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-member" />
          <span className="truncate">最近一场 · {formatDate(stream.startedAt)}</span>
        </p>
        <Link
          className="shrink-0 text-caption text-muted-foreground transition-colors duration-120 ease-out hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member"
          to={streamPath(datasetId, stream.videoId)}
        >
          打开单场详情 →
        </Link>
      </div>

      <h3 className="mt-1.5 text-title text-foreground">
        <Link
          className="line-clamp-2 transition-colors duration-120 ease-out hover:text-member focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member"
          to={streamPath(datasetId, stream.videoId)}
        >
          {stream.title}
        </Link>
      </h3>

      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
        <span className="tabular-nums">
          {formatWeekday(stream.startedAt)} · {formatTime(stream.startedAt)} 开播
        </span>
        <span aria-hidden="true" className="text-ink-3">
          ·
        </span>
        <span className="tabular-nums">{formatDurationLong(stream.durationSec)}</span>
        {memberOnly ? (
          <>
            <span aria-hidden="true" className="text-ink-3">
              ·
            </span>
            <Badge size="sm" variant="outline">
              会员限定
            </Badge>
          </>
        ) : null}
      </div>

      <MetricStrip className="mt-4" columns={6} items={metrics} />

      <div className="mt-4">
        <p className="text-caption text-ink-3">最近 {rates.length} 场 · 弹幕 / 分</p>
        <Sparkline
          area
          ariaLabel="最近 12 场每分钟弹幕趋势"
          height={82}
          peakIndex={peakIndex}
          values={rates}
        />
      </div>

      {peak || bestSc ? (
        <div className="mt-3 flex flex-col gap-1 border-t border-hairline pt-2.5 text-caption text-ink-3">
          {peak ? (
            <p className="truncate">
              全期峰值出现在{" "}
              <span className="tabular-nums font-medium text-foreground">
                {formatDate(peak.at)} {formatTime(peak.at)}
              </span>{" "}
              · 弹幕{" "}
              <span className="tabular-nums font-medium text-foreground">
                {formatInteger(peak.value)}
              </span>{" "}
              条
            </p>
          ) : null}
          {bestSc ? (
            <p className="flex min-w-0 items-baseline gap-1">
              <span className="shrink-0">SC 最多为</span>
              <Link
                className="min-w-0 truncate font-medium text-foreground underline-offset-2 transition-colors duration-120 ease-out hover:text-member hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member"
                to={streamPath(datasetId, bestSc.videoId)}
              >
                {bestSc.title}
              </Link>
              <span className="shrink-0 tabular-nums font-medium text-foreground">
                {formatInteger(bestSc.value)}
              </span>
              <span className="shrink-0">笔</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
