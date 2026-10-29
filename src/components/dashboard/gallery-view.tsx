import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { StreamCover } from "@/components/dashboard/stream-cover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDate, formatInteger } from "@/lib/format";
import { streamPath } from "@/lib/routes";
import type { StreamSummary } from "@/types/dataset";

export type GalleryOrder = "desc" | "asc";

interface GalleryViewProps {
  datasetId: string;
  rows: StreamSummary[];
}

interface MonthGroup {
  key: string;
  label: string;
  rows: StreamSummary[];
}

const ORDER_OPTIONS: { value: GalleryOrder; label: string }[] = [
  { value: "desc", label: "最新在前" },
  { value: "asc", label: "最早在前" },
];

const UNKNOWN_MONTH = "unknown";

const CHIP_CLASS =
  "rounded-full px-2.5 text-footnote text-muted-foreground before:rounded-full hover:text-foreground data-pressed:bg-foreground data-pressed:text-background data-pressed:hover:bg-foreground data-pressed:hover:text-background";

/** `2026-10` → `2026 年 10 月`；缺日期的旧数据单独成组，不静默丢弃。 */
function monthLabel(key: string): string {
  if (key === UNKNOWN_MONTH) return "日期未知";
  const [year, month] = key.split("-");
  return `${year} 年 ${Number(month)} 月`;
}

function monthKey(row: StreamSummary): string {
  return row.date && row.date.length >= 7 ? row.date.slice(0, 7) : UNKNOWN_MONTH;
}

function sortKey(row: StreamSummary): string {
  return row.startedAt ?? row.date ?? "";
}

/** 一个读数：优先峰值同接，没有 VSTATS 时退回弹幕。 */
function cardMetric(row: StreamSummary): { label: string; value: string } {
  if (row.maxConcurrent != null) {
    return { label: "峰值同接", value: formatInteger(row.maxConcurrent) };
  }
  return { label: "弹幕", value: formatInteger(row.chatTotal) };
}

function buildGroups(rows: StreamSummary[], order: GalleryOrder): MonthGroup[] {
  const buckets = new Map<string, StreamSummary[]>();

  for (const row of rows) {
    const key = monthKey(row);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const sorted = [...bucket].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
      return {
        key,
        label: monthLabel(key),
        rows: order === "asc" ? sorted : sorted.reverse(),
      };
    })
    .sort((a, b) => (order === "asc" ? a.key.localeCompare(b.key) : b.key.localeCompare(a.key)));
}

/**
 * 封面墙：按 JST 自然月分组，一屏之内也能看出「那天的画面」。
 * 排序写进 `?order=asc`（默认最新不写参数），保持可分享、可回退。
 */
export function GalleryView({ datasetId, rows }: GalleryViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const order: GalleryOrder = searchParams.get("order") === "asc" ? "asc" : "desc";
  const groups = useMemo(() => buildGroups(rows, order), [rows, order]);

  function changeOrder(next: string[]): void {
    const [value] = next;
    const params = new URLSearchParams(searchParams);
    if (value === "asc") params.set("order", "asc");
    else params.delete("order");
    // 排序不进历史记录，和场次表的筛选保持一致。
    setSearchParams(params, { replace: true });
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-panel bg-card px-4 py-8 shadow-surface">
        <p className="text-body text-foreground">还没有可以放进相册的场次。</p>
        <p className="text-footnote text-muted-foreground">
          抓到场次数据后，封面会按 JST 自然月自动排列在这里。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-caption text-muted-foreground tabular-nums">
          共 {formatInteger(rows.length)} 场 · 按 JST 自然月分组
        </p>
        <ToggleGroup
          aria-label="相册排序"
          onValueChange={changeOrder}
          size="sm"
          value={[order]}
        >
          {ORDER_OPTIONS.map(option => (
            <ToggleGroupItem className={CHIP_CLASS} key={option.value} value={option.value}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {groups.map(group => {
        const headingId = `gallery-month-${group.key}`;

        return (
          <section
            aria-labelledby={headingId}
            className="flex flex-col gap-3 [contain-intrinsic-size:auto_40rem] [content-visibility:auto]"
            key={group.key}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-hairline pb-1.5">
              <h2 className="text-headline text-foreground" id={headingId}>
                {group.label}
              </h2>
              <p className="text-caption text-ink-3 tabular-nums">{group.rows.length} 场</p>
            </div>

            <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4">
              {group.rows.map(row => {
                const metric = cardMetric(row);

                return (
                  <li className="min-w-0" key={row.videoId}>
                    <Link
                      className="group flex flex-col gap-2 rounded-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink"
                      to={streamPath(datasetId, row.videoId)}
                    >
                      <StreamCover
                        className="transition-[filter] duration-120 ease-out group-hover:brightness-[1.06]"
                        datasetId={datasetId}
                        sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 45vw"
                        thumbnail={row.thumbnail}
                        title={row.title}
                        videoId={row.videoId}
                      />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <p className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-caption text-muted-foreground">
                          <span className="tabular-nums">{formatDate(row.startedAt)}</span>
                          <span className="tabular-nums">
                            <span className="text-ink-3">{metric.label}</span>{" "}
                            <span className="font-medium text-foreground">{metric.value}</span>
                          </span>
                        </p>
                        <p className="line-clamp-2 text-body text-foreground transition-colors duration-120 ease-out group-hover:text-member-ink">
                          {row.title}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
