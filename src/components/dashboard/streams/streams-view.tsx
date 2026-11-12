import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/dashboard/primitives/data-table";
import { PageHeader, type Fact } from "@/components/dashboard/primitives/page-header";
import { StreamList } from "@/components/dashboard/streams/stream-list";
import { StreamsToolbar } from "@/components/dashboard/streams/streams-toolbar";
import { Button } from "@/components/ui/button";
import { formatDurationLong, formatInteger } from "@/lib/format";
import { streamPath } from "@/lib/routes";
import {
  DEFAULT_TABLE_PARAMS,
  type TableParams,
  isTableSortKey,
} from "@/lib/table-params";
import type { StreamSummary } from "@/types/dataset";
import { cn } from "@/lib/utils";
import { buildStreamColumns } from "./stream-columns";
import {
  averageDuration,
  buildStartTimes,
  buildStreamsCsv,
  downloadCsv,
  filterKeyOf,
  filterStreams,
} from "./stream-filters";

const INITIAL_VISIBLE_ROWS = 100;
const VISIBLE_STEP = 200;

export interface StreamsViewProps {
  rows: StreamSummary[];
  /** 用于把行渲染成真实链接（`streamPath`），保留中键 / 新标签打开。 */
  datasetId: string;
  params: TableParams;
  onParamsChange: (next: TableParams) => void;
}

export function StreamsView({ rows, datasetId, params, onParamsChange }: StreamsViewProps) {
  const { q, type: typeFilter, sort, dir, vstats: onlyVstats, member: onlyMember } = params;
  const hasFilters = Boolean(q.trim() || typeFilter || onlyVstats || onlyMember);

  const facts = useMemo<Fact[]>(() => {
    const chatTotal = rows.reduce((sum, row) => sum + row.chatTotal, 0);
    const withConcurrent = rows.filter(row => row.avgConcurrent != null).length;
    return [
      { value: formatInteger(rows.length), label: "总场次" },
      { value: formatInteger(withConcurrent), label: "有同接场次" },
      { value: formatDurationLong(averageDuration(rows)), label: "平均时长" },
      { value: formatInteger(chatTotal), label: "总弹幕" },
    ];
  }, [rows]);

  // 日期排序只解析一次：比较器里每次 Date.parse 会让 500 场排序变成上万次解析。
  const startTimes = useMemo(() => buildStartTimes(rows), [rows]);

  const visible = useMemo(
    () =>
      filterStreams(
        rows,
        { q, type: typeFilter, onlyVstats, onlyMember },
        sort,
        dir,
        startTimes,
      ),
    [rows, startTimes, q, typeFilter, onlyVstats, onlyMember, sort, dir],
  );

  // 初次只渲染一部分行：500 场全铺进 HTML 会让首字节膨胀到 MB 级。
  // 筛选条件变化时回到首批，避免旧上限让结果看起来是空的。
  const filterKey = filterKeyOf(params);
  const [page, setPage] = useState({ key: filterKey, limit: INITIAL_VISIBLE_ROWS });
  const limit = page.key === filterKey ? page.limit : INITIAL_VISIBLE_ROWS;
  const rendered = useMemo(() => visible.slice(0, limit), [visible, limit]);
  const remaining = visible.length - rendered.length;

  function showMore(): void {
    setPage({ key: filterKey, limit: limit + VISIBLE_STEP });
  }

  // 默认只铺六列；其余指标按 URL 里的 cols 追加，避免首屏十二列同时抢注意力。
  const columns = useMemo(() => buildStreamColumns(new Set(params.cols)), [params.cols]);

  function handleSort(key: string): void {
    if (!isTableSortKey(key)) return;
    if (key === sort) {
      onParamsChange({ ...params, dir: dir === "asc" ? "desc" : "asc" });
      return;
    }
    onParamsChange({ ...params, sort: key, dir: "desc" });
  }

  function resetFilters(): void {
    onParamsChange({ ...DEFAULT_TABLE_PARAMS });
  }

  function exportCsv(): void {
    downloadCsv(buildStreamsCsv(visible), `${datasetId}-streams.csv`);
  }

  return (
    <div className="flex flex-col gap-3">
      <PageHeader facts={facts} title="场次" />

      <section aria-label="场次列表" className="flex flex-col gap-2">
        <StreamsToolbar onExport={exportCsv} onParamsChange={onParamsChange} params={params} />

        {visible.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-panel bg-card px-4 py-8 shadow-surface">
            <p className="text-body text-muted-foreground">
              {hasFilters ? "没有匹配的场次" : "还没有场次"}
            </p>
            {hasFilters ? (
              <Button onClick={resetFilters} size="sm" type="button" variant="outline">
                <RotateCcw aria-hidden="true" />
                清除筛选
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-panel bg-card shadow-surface md:hidden">
              <StreamList datasetId={datasetId} empty={hasFilters ? "没有匹配的场次" : "还没有场次"} rows={rendered} />
            </div>

            <div
              className={cn(
                "hidden rounded-panel bg-card md:block",
                // coss Table 把 <table> 包在 overflow-x-auto 的容器里且没有高度上限，
                // 直接 sticky 无效。这里把该容器变成有界滚动视口（桌面），
                // 并把吸顶偏移从 top-14 归零，让表头真正贴住滚动区域顶部。
                "lg:[&>[data-slot=table-container]]:max-h-[calc(100dvh-13rem)] lg:[&>[data-slot=table-container]]:overflow-auto",
                "[&>[data-slot=table-container]]:rounded-panel",
                "[&_thead_th]:top-0 [&_thead_th]:h-8 [&_thead_th]:border-b [&_thead_th]:border-hairline",
              )}
            >
              <DataTable
                ariaLabel="场次列表"
                className="min-w-[48rem]"
                columns={columns}
                onSort={handleSort}
                rowHref={row => streamPath(row.datasetId ?? datasetId, row.videoId)}
                rowKey={row => row.videoId}
                rowLabel={row => `打开 ${row.title}`}
                rows={rendered}
                sort={{ key: sort, dir }}
                stickyFirstColumn
                stickyHeader
              />
            </div>
          </>
        )}

        {remaining > 0 ? (
          <div className="flex justify-center py-2">
            <Button onClick={showMore} size="sm" type="button" variant="outline">
              再显示 {formatInteger(Math.min(remaining, VISIBLE_STEP))} 场（剩余{" "}
              {formatInteger(remaining)} 场）
            </Button>
          </div>
        ) : null}

        <footer className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-caption text-ink-3">
          <p className="tabular-nums">
            共 {formatInteger(rows.length)} 场 · 筛选后 {formatInteger(visible.length)} 场
          </p>
        </footer>
      </section>
    </div>
  );
}
