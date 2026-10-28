import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { StreamRow } from "@/lib/aggregate";
import { formatDate, formatDuration, formatInteger, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface StreamTableProps {
  rows: StreamRow[];
  onSelect?: (videoId: string) => void;
  selectedId?: string | null;
  limit?: number;
}

export function StreamTable({ rows, onSelect, selectedId, limit }: StreamTableProps) {
  const visible = limit == null ? rows : rows.slice(0, limit);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>日期</TableHead>
          <TableHead>直播</TableHead>
          <TableHead className="text-right">时长</TableHead>
          <TableHead className="text-right">同接（均 / 峰）</TableHead>
          <TableHead className="text-right">弹幕</TableHead>
          <TableHead className="text-right">SC</TableHead>
          <TableHead className="text-right">评论</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {visible.map(row => {
          const selected = row.summary.videoId === selectedId;
          const memberOnly = row.pack.video.availability === "subscriber_only";
          return (
            <TableRow
              className={cn(onSelect && "cursor-pointer", selected && "bg-accent/60")}
              data-state={selected ? "selected" : undefined}
              key={row.summary.videoId}
              onClick={() => onSelect?.(row.summary.videoId)}
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
                  <span className="max-w-[320px] truncate">{row.summary.title}</span>
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
                {formatInteger(row.pack.vstats?.avgConcurrent ?? null)} /{" "}
                {formatInteger(row.pack.vstats?.maxConcurrent ?? null)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {formatInteger(row.pack.chat.total)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {row.pack.chat.paid.superchats.length}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {formatInteger(row.pack.comments?.total ?? null)}
              </TableCell>
            </TableRow>
          );
        })}
        {visible.length === 0 ? (
          <TableRow>
            <TableCell className="py-8 text-center text-muted-foreground" colSpan={7}>
              没有匹配的直播
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
