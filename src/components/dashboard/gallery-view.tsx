import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { StreamCover } from "@/components/dashboard/stream-cover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { memberAccent } from "@/lib/color";
import { formatDate, formatInteger } from "@/lib/format";
import { type GalleryOrder, parseGalleryOrder, writeGalleryOrder } from "@/lib/gallery-params";
import { DEFAULT_MEMBER_COLOR } from "@/lib/group";
import { streamPath } from "@/lib/routes";
import type { GroupStreamSummary } from "@/types/group";

export type { GalleryOrder };

/** 相册的一行：精简场次字段自带归属成员，单成员与混合成员共用同一份渲染。 */
export interface GalleryRow extends GroupStreamSummary {
  memberLabel?: string;
  memberColor?: string;
}

interface GalleryViewProps {
  rows: GalleryRow[];
  /** 混合成员的相册：每张卡多一条成员标识（原始色点 + 按主题校正的可读色文字）。 */
  showMember?: boolean;
  /** 额外筛选条（组页的成员 / 类型 chip），渲染在摘要上方。 */
  filters?: ReactNode;
  /** 筛选后为空时替换默认空态，方便给出「清除筛选」。 */
  emptyState?: ReactNode;
}

interface MonthGroup {
  key: string;
  label: string;
  rows: GalleryRow[];
}

const ORDER_OPTIONS: { value: GalleryOrder; label: string }[] = [
  { value: "desc", label: "最新在前" },
  { value: "asc", label: "最早在前" },
];

const UNKNOWN_MONTH = "unknown";

const CHIP_CLASS =
  "rounded-full px-2.5 text-footnote text-muted-foreground before:rounded-full hover:text-foreground data-pressed:bg-foreground data-pressed:text-background data-pressed:hover:bg-foreground data-pressed:hover:text-background";

/** 成员色缓存：同一成员的所有卡片共用一份明暗两套 ink，避免逐卡计算对比度。 */
const INK_CACHE = new Map<string, { light: string; dark: string }>();

function memberInk(color: string): { light: string; dark: string } {
  const cached = INK_CACHE.get(color);
  if (cached) return cached;
  const ink = { dark: memberAccent(color, "dark"), light: memberAccent(color, "light") };
  INK_CACHE.set(color, ink);
  return ink;
}

/**
 * 成员标识：色点保留数据里的原始成员色，文字用 `memberAccent` 校正过的可读色。
 * 两套 ink 交给 CSS 变量 + `dark:` 变体，不依赖 JS 主题状态，切主题时立即生效。
 */
function MemberTag({ label, color }: { label: string; color: string }) {
  const ink = memberInk(color);
  const style = {
    "--gallery-member-ink-dark": ink.dark,
    "--gallery-member-ink-light": ink.light,
  } as CSSProperties;

  return (
    <span className="inline-flex min-w-0 items-center gap-1" style={style}>
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="truncate text-[var(--gallery-member-ink-light)] dark:text-[var(--gallery-member-ink-dark)]">
        {label}
      </span>
    </span>
  );
}

/** `2026-10` → `2026 年 10 月`；缺日期的旧数据单独成组，不静默丢弃。 */
function monthLabel(key: string): string {
  if (key === UNKNOWN_MONTH) return "日期未知";
  const [year, month] = key.split("-");
  return `${year} 年 ${Number(month)} 月`;
}

function monthKey(row: GroupStreamSummary): string {
  return row.date && row.date.length >= 7 ? row.date.slice(0, 7) : UNKNOWN_MONTH;
}

function sortKey(row: GroupStreamSummary): string {
  return row.startedAt ?? row.date ?? "";
}

/** 一个读数：优先峰值同接，没有 VSTATS 时退回弹幕。 */
function cardMetric(row: GroupStreamSummary): { label: string; value: string } {
  if (row.maxConcurrent != null) {
    return { label: "峰值同接", value: formatInteger(row.maxConcurrent) };
  }
  return { label: "弹幕", value: formatInteger(row.chatTotal) };
}

function buildGroups(rows: GalleryRow[], order: GalleryOrder): MonthGroup[] {
  const buckets = new Map<string, GalleryRow[]>();

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

function GalleryEmpty() {
  return (
    <div className="flex flex-col gap-2 rounded-panel bg-card px-4 py-8 shadow-surface">
      <p className="text-body text-foreground">还没有可以放进相册的场次。</p>
    </div>
  );
}

/**
 * 封面墙：按 JST 自然月分组，一屏之内也能看出「那天的画面」。
 * 排序写进 `?order=asc`（默认最新不写参数），保持可分享、可回退。
 * 单成员与全组共用：混合时每张卡多一条成员标识，链接与封面都用行自带的 `datasetId`。
 */
export function GalleryView({
  rows,
  showMember = false,
  filters,
  emptyState,
}: GalleryViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const order = parseGalleryOrder(searchParams.get("order"));
  const groups = useMemo(() => buildGroups(rows, order), [rows, order]);

  function changeOrder(next: string[]): void {
    const [value] = next;
    // 再点一次已选中的 chip 会得到空数组，按默认（最新在前）处理。
    const nextOrder = parseGalleryOrder(value);
    // 排序不进历史记录，且不碰筛选参数，和场次表保持一致。
    setSearchParams(writeGalleryOrder(searchParams, nextOrder), { replace: true });
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.length > 0 || filters ? (
        <div className="flex min-w-0 flex-col gap-3">
          {filters}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <p className="text-caption text-muted-foreground tabular-nums">
              共 {formatInteger(rows.length)} 场
            </p>
            <ToggleGroup aria-label="相册排序" onValueChange={changeOrder} size="sm" value={[order]}>
              {ORDER_OPTIONS.map(option => (
                <ToggleGroupItem
                  aria-label={`排序：${option.label}`}
                  className={CHIP_CLASS}
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
      ) : null}

      {rows.length === 0
        ? (emptyState ?? <GalleryEmpty />)
        : groups.map(group => {
            const headingId = `gallery-month-${group.key}`;

            return (
              <section
                aria-labelledby={headingId}
                className="flex flex-col gap-3 [contain-intrinsic-size:auto_40rem] [content-visibility:auto]"
                key={group.key}
              >
                <div className="sticky top-12 z-20 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-hairline bg-background pt-2 pb-1.5">
                  <h2 className="text-headline text-foreground" id={headingId}>
                    {group.label}
                  </h2>
                  <p className="text-caption text-ink-3 tabular-nums">{group.rows.length} 场</p>
                </div>

                <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4">
                  {group.rows.map(row => {
                    const metric = cardMetric(row);
                    const memberLabel = row.memberLabel ?? row.datasetId;
                    const memberColor = row.memberColor ?? DEFAULT_MEMBER_COLOR;

                    return (
                      <li className="min-w-0" key={`${row.datasetId}/${row.videoId}`}>
                        <Link
                          className="press group flex flex-col gap-2 rounded-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink"
                          to={streamPath(row.datasetId, row.videoId)}
                        >
                          <StreamCover
                            className="transition-[filter] duration-120 ease-out group-hover:brightness-[1.06]"
                            datasetId={row.datasetId}
                            sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 45vw"
                            thumbnail={row.thumbnail}
                            title={row.title}
                            videoId={row.videoId}
                          />
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted-foreground">
                              <span className="tabular-nums">{formatDate(row.startedAt)}</span>
                              {showMember ? (
                                <MemberTag color={memberColor} label={memberLabel} />
                              ) : null}
                              <span className="ms-auto tabular-nums">
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
