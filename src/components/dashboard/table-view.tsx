import { ArrowDown, ArrowUp, Download, RotateCcw, Search } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { StreamRow } from "@/lib/aggregate";
import {
  formatDate,
  formatDuration,
  formatInteger,
  formatPercent,
  formatTime,
} from "@/lib/format";
import {
  DEFAULT_TABLE_PARAMS,
  type SortDirection,
  type TableParams,
  type TableSortKey,
} from "@/lib/table-params";
import { cn } from "@/lib/utils";

interface TableViewProps {
  rows: StreamRow[];
  onSelect: (videoId: string) => void;
  params: TableParams;
  onParamsChange: (next: TableParams) => void;
}

interface SortableHeadProps {
  label: string;
  sortKey: TableSortKey;
  active: TableSortKey;
  direction: SortDirection;
  onSort: (key: TableSortKey) => void;
  className?: string;
}

function SortableHead({
  label,
  sortKey,
  active,
  direction,
  onSort,
  className,
}: SortableHeadProps) {
  const isActive = active === sortKey;
  return (
    <TableHead className={className}>
      <button
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground",
          isActive && "text-foreground",
        )}
        onClick={() => onSort(sortKey)}
        type="button"
      >
        {label}
        {isActive ? (
          direction === "asc" ? (
            <ArrowUp aria-hidden="true" className="size-3" />
          ) : (
            <ArrowDown aria-hidden="true" className="size-3" />
          )
        ) : null}
      </button>
    </TableHead>
  );
}

function sortValue(row: StreamRow, key: TableSortKey): number | null {
  switch (key) {
    case "date":
      return row.summary.startedAt ? Date.parse(row.summary.startedAt) : null;
    case "duration":
      return row.summary.durationSec;
    case "avg":
      return row.pack.vstats?.avgConcurrent ?? null;
    case "max":
      return row.pack.vstats?.maxConcurrent ?? null;
    case "watch":
      return row.pack.vstats?.watchTimeHours ?? null;
    case "views":
      return row.pack.vstats?.views ?? row.pack.video.snapshot.views;
    case "likes":
      return row.pack.vstats?.likes ?? row.pack.video.snapshot.likes;
    case "chat":
      return row.pack.chat.total;
    case "authors":
      return row.pack.chat.uniqueAuthors;
    case "sc":
      return row.pack.chat.paid.superchats.length;
    case "comments":
      return row.pack.comments?.total ?? null;
    default:
      return null;
  }
}

function escapeCsv(value: string | number | null | undefined): string {
  if (value == null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function TableView({ rows, onSelect, params, onParamsChange }: TableViewProps) {
  const { q: query, sort: sortKey, dir: direction, vstats: onlyVstats } = params;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = rows.filter(row => {
      if (onlyVstats && !row.pack.vstats) return false;
      if (!needle) return true;
      return `${row.summary.title} ${row.summary.date} ${row.summary.videoId}`
        .toLowerCase()
        .includes(needle);
    });

    return [...filtered].sort((a, b) => {
      const left = sortValue(a, sortKey);
      const right = sortValue(b, sortKey);
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      return direction === "asc" ? left - right : right - left;
    });
  }, [rows, query, onlyVstats, sortKey, direction]);

  function handleSort(key: TableSortKey): void {
    if (key === sortKey) {
      onParamsChange({ ...params, dir: direction === "asc" ? "desc" : "asc" });
      return;
    }
    onParamsChange({ ...params, sort: key, dir: "desc" });
  }

  function exportCsv(): void {
    const headers = [
      "日期",
      "标题",
      "videoId",
      "时长",
      "平均同接",
      "最大同接",
      "视聴时间(人时)",
      "播放",
      "点赞",
      "弹幕",
      "发言人数",
      "SC",
      "评论",
    ];
    const body = visible.map(row => [
      row.summary.date,
      row.summary.title,
      row.summary.videoId,
      row.summary.durationHms,
      row.pack.vstats?.avgConcurrent,
      row.pack.vstats?.maxConcurrent,
      row.pack.vstats?.watchTimeHours,
      row.pack.vstats?.views ?? row.pack.video.snapshot.views,
      row.pack.vstats?.likes ?? row.pack.video.snapshot.likes,
      row.pack.chat.total,
      row.pack.chat.uniqueAuthors,
      row.pack.chat.paid.superchats.length,
      row.pack.comments?.total,
    ]);
    const csv = [headers, ...body]
      .map(line => line.map(escapeCsv).join(","))
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "yumemita-streams.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function resetFilters(): void {
    onParamsChange({ ...DEFAULT_TABLE_PARAMS });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="搜索直播"
            className="pl-8"
            onChange={event => onParamsChange({ ...params, q: event.target.value })}
            placeholder="搜索标题 / 日期 / videoId"
            type="search"
            value={query}
          />
        </div>
        <Label className="flex items-center gap-2 whitespace-nowrap text-xs">
          <Checkbox
            checked={onlyVstats}
            onCheckedChange={checked => onParamsChange({ ...params, vstats: checked === true })}
          />
          仅有 VSTATS
        </Label>
        <Button onClick={resetFilters} size="sm" type="button" variant="ghost">
          <RotateCcw aria-hidden="true" />
          重置
        </Button>
        <Button onClick={exportCsv} size="sm" type="button" variant="outline">
          <Download aria-hidden="true" />
          导出 CSV
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
        <span>
          共 {rows.length} 场，筛选后 {visible.length} 场
        </span>
        <Badge variant="outline">点击表头排序</Badge>
        <Badge variant="outline">点击行查看单场</Badge>
      </div>

      <Table variant="card">
        <TableHeader>
          <TableRow>
            <SortableHead
              active={sortKey}
              direction={direction}
              label="日期"
              onSort={handleSort}
              sortKey="date"
            />
            <TableHead>直播</TableHead>
            <SortableHead
              active={sortKey}
              className="text-right"
              direction={direction}
              label="时长"
              onSort={handleSort}
              sortKey="duration"
            />
            <SortableHead
              active={sortKey}
              className="text-right"
              direction={direction}
              label="平均"
              onSort={handleSort}
              sortKey="avg"
            />
            <SortableHead
              active={sortKey}
              className="text-right"
              direction={direction}
              label="最大"
              onSort={handleSort}
              sortKey="max"
            />
            <SortableHead
              active={sortKey}
              className="text-right"
              direction={direction}
              label="视聴"
              onSort={handleSort}
              sortKey="watch"
            />
            <SortableHead
              active={sortKey}
              className="text-right"
              direction={direction}
              label="播放"
              onSort={handleSort}
              sortKey="views"
            />
            <SortableHead
              active={sortKey}
              className="text-right"
              direction={direction}
              label="点赞"
              onSort={handleSort}
              sortKey="likes"
            />
            <SortableHead
              active={sortKey}
              className="text-right"
              direction={direction}
              label="弹幕"
              onSort={handleSort}
              sortKey="chat"
            />
            <SortableHead
              active={sortKey}
              className="text-right"
              direction={direction}
              label="人数"
              onSort={handleSort}
              sortKey="authors"
            />
            <SortableHead
              active={sortKey}
              className="text-right"
              direction={direction}
              label="SC"
              onSort={handleSort}
              sortKey="sc"
            />
            <SortableHead
              active={sortKey}
              className="text-right"
              direction={direction}
              label="评论"
              onSort={handleSort}
              sortKey="comments"
            />
            <TableHead className="text-right">点赞率</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map(row => {
            const memberOnly = row.pack.video.availability === "subscriber_only";
            return (
              <TableRow
                className="cursor-pointer"
                key={row.summary.videoId}
                onClick={() => onSelect(row.summary.videoId)}
              >
                <TableCell className="font-mono text-xs">
                  <div className="flex flex-col gap-0.5">
                    <span>{formatDate(row.summary.startedAt)}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatTime(row.summary.startedAt)}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className="max-w-[340px] truncate">{row.summary.title}</span>
                    {memberOnly ? (
                      <Badge className="shrink-0 text-[10px]" variant="outline">
                        会员
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatDuration(row.summary.durationSec)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatInteger(row.pack.vstats?.avgConcurrent ?? null)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatInteger(row.pack.vstats?.maxConcurrent ?? null)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatInteger(row.pack.vstats?.watchTimeHours ?? null)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatInteger(row.pack.vstats?.views ?? row.pack.video.snapshot.views)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatInteger(row.pack.vstats?.likes ?? row.pack.video.snapshot.likes)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatInteger(row.pack.chat.total)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatInteger(row.pack.chat.uniqueAuthors)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {row.pack.chat.paid.superchats.length}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatInteger(row.pack.comments?.total ?? null)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatPercent(
                    row.pack.derived.likesPer1000Views != null
                      ? row.pack.derived.likesPer1000Views / 10
                      : null,
                    2,
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {visible.length === 0 ? (
            <TableRow>
              <TableCell className="py-10 text-center text-muted-foreground" colSpan={13}>
                没有匹配的直播
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
