import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDate, formatInteger, formatTime } from "@/lib/format";
import type { StreamSummary } from "@/types/dataset";
import { cn } from "@/lib/utils";

interface StreamPickerProps {
  rows: StreamSummary[];
  selectedId: string | null;
  onSelect: (videoId: string) => void;
}

export function StreamPicker({ rows, selectedId, onSelect }: StreamPickerProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(row =>
      `${row.title} ${row.date} ${row.videoId}`.toLowerCase().includes(needle),
    );
  }, [rows, query]);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="搜索直播标题或日期"
          className="pl-8"
          onChange={event => setQuery(event.target.value)}
          placeholder="搜索标题 / 日期 / videoId"
          type="search"
          value={query}
        />
      </div>

      <ScrollArea className="h-64 rounded-lg border sm:h-[560px]">
        <div className="flex flex-col gap-1 p-1.5">
          {filtered.map(row => {
            const selected = row.videoId === selectedId;
            const memberOnly = row.availability === "subscriber_only";
            return (
              <button
                className={cn(
                  "rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent",
                  selected && "bg-accent",
                )}
                key={row.videoId}
                onClick={() => onSelect(row.videoId)}
                type="button"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {formatDate(row.startedAt)} {formatTime(row.startedAt)}
                  </span>
                  {memberOnly ? (
                    <Badge className="text-[10px]" variant="outline">
                      会员
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs leading-snug">{row.title}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {formatInteger(row.chatTotal)} 条弹幕 · {row.superchats} SC ·{" "}
                  {formatInteger(row.avgConcurrent)} 平均同接
                </p>
              </button>
            );
          })}
          {filtered.length === 0 ? (
            <p className="p-3 text-center text-muted-foreground text-xs">没有匹配的直播</p>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
