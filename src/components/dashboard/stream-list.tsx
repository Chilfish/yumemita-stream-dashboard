import { Link } from "react-router";
import { CONTENT_TYPE_LABELS, classifyTitle } from "@/lib/classify";
import { formatDate, formatDuration, formatInteger, formatTime } from "@/lib/format";
import { streamPath } from "@/lib/routes";
import type { StreamSummary } from "@/types/dataset";
import { cn } from "@/lib/utils";

interface StreamListProps {
  datasetId: string;
  rows: StreamSummary[];
  empty?: string;
  className?: string;
}

interface ValueProps {
  label: string;
  value: string;
}

function Value({ label, value }: ValueProps) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-ink-3">{label}</span>
      <span className="font-medium text-foreground tabular-nums">{value}</span>
    </span>
  );
}

/**
 * 窄屏场次列表：两行式，标题占一行，四个关键数字平铺。
 * 宽表在手机上只剩「日期 + 半截标题」，这里换成不横向滚动的等价信息。
 */
export function StreamList({ datasetId, rows, empty, className }: StreamListProps) {
  if (rows.length === 0) {
    return (
      <p className={cn("px-4 py-8 text-center text-footnote text-muted-foreground", className)}>
        {empty ?? "暂无数据"}
      </p>
    );
  }

  return (
    <ul className={cn("divide-y divide-hairline", className)}>
      {rows.map(row => {
        const { key, matched } = classifyTitle(row.title);

        return (
          <li key={row.videoId}>
            <Link
              className="flex flex-col gap-1.5 px-4 py-3 transition-colors duration-120 ease-out active:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-member"
              to={streamPath(datasetId, row.videoId)}
            >
              <div className="flex items-baseline gap-2 text-caption text-ink-3">
                <span className="tabular-nums">
                  {formatDate(row.startedAt)} {formatTime(row.startedAt)}
                </span>
                <span className={matched ? "text-muted-foreground" : "text-ink-3"}>
                  {CONTENT_TYPE_LABELS[key]}
                </span>
                {row.availability === "subscriber_only" ? <span>会员限定</span> : null}
                <span className="ms-auto tabular-nums">{formatDuration(row.durationSec)}</span>
              </div>

              <p className="line-clamp-2 text-body text-foreground">{row.title}</p>

              <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-caption">
                <Value label="平均" value={formatInteger(row.avgConcurrent)} />
                <Value label="峰值" value={formatInteger(row.maxConcurrent)} />
                <Value label="弹幕" value={formatInteger(row.chatTotal)} />
                <Value label="SC" value={formatInteger(row.superchats)} />
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
