import { CalendarPlus, Pencil, Trash2 } from "lucide-react";
import { useMemo } from "react";
import type { DatasetOption } from "@/components/admin/schedule-form-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CALENDAR_STATE_LABELS } from "@/lib/calendar-labels";
import { CONTENT_TYPE_LABELS } from "@/lib/classify";
import { groupSchedulesByDate, SLOT_LABELS } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import type { AdminScheduleItem, CalendarEventState } from "@/types/calendar";

const jstTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function itemTimeLabel(item: AdminScheduleItem): string {
  if (item.timeTentative && item.slot) return SLOT_LABELS[item.slot];
  if (!item.scheduledAt) return "—";
  return jstTimeFormat.format(new Date(item.scheduledAt));
}

function stateTone(state: CalendarEventState): "secondary" | "error" | "outline" | "warning" {
  if (state === "live") return "error";
  if (state === "pending") return "warning";
  if (state === "upcoming") return "outline";
  return "secondary";
}

function memberLabel(item: AdminScheduleItem, datasets: DatasetOption[]): string {
  return datasets.find(dataset => dataset.id === item.datasetId)?.label ?? item.datasetId;
}

function KindBadge({ item }: { item: AdminScheduleItem }) {
  if (!item.kind) return null;
  return (
    <Badge className="me-1.5" size="sm" variant="outline">
      {CONTENT_TYPE_LABELS[item.kind]}
    </Badge>
  );
}

function StateBadge({ item }: { item: AdminScheduleItem }) {
  return (
    <Badge size="sm" variant={stateTone(item.state)}>
      {CALENDAR_STATE_LABELS[item.state]}
    </Badge>
  );
}

function MatchStatus({ item, className }: { item: AdminScheduleItem; className?: string }) {
  return (
    <span className={cn("text-ink-3", className)}>
      {item.matchedStream
        ? (
            <a className="text-foreground underline underline-offset-2" href={item.matchedStream.href}>
              {item.matchedStream.title}
            </a>
          )
        : item.source === "youtube"
          ? "自动同步"
          : "未匹配"}
    </span>
  );
}

function RowActions({
  item,
  onEdit,
  onDelete,
}: {
  item: AdminScheduleItem;
  onEdit: (item: AdminScheduleItem) => void;
  onDelete: (item: AdminScheduleItem) => void;
}) {
  return (
    <div className="flex shrink-0 justify-end gap-1">
      <Button
        aria-label={`编辑 ${item.title || "待定"}`}
        onClick={() => onEdit(item)}
        size="icon-sm"
        variant="ghost"
      >
        <Pencil aria-hidden="true" />
      </Button>
      <Button
        aria-label={`删除 ${item.title || "待定"}`}
        disabled={item.source !== "manual"}
        onClick={() => onDelete(item)}
        size="icon-sm"
        variant="ghost"
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </div>
  );
}

interface ScheduleListProps {
  items: AdminScheduleItem[];
  datasets: DatasetOption[];
  onEdit: (item: AdminScheduleItem) => void;
  onDelete: (item: AdminScheduleItem) => void;
}

export function ScheduleList({ items, datasets, onEdit, onDelete }: ScheduleListProps) {
  const grouped = useMemo(() => groupSchedulesByDate(items), [items]);

  return (
    <section className="overflow-hidden rounded-xl border border-hairline bg-card">
      <div className="flex items-baseline justify-between gap-2 border-b border-hairline px-4 py-3 sm:px-5">
        <h2 className="text-headline text-foreground">未来日程</h2>
        <span className="text-caption text-ink-3">近 7 天到未来 60 天</span>
      </div>

      {items.length === 0
        ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarPlus aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>还没有排期</EmptyTitle>
                <EmptyDescription>在上方添加第一条日程。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )
        : (
            <div className="flex flex-col">
              {grouped.map(([date, dayItems]) => (
                <div className="border-t border-hairline first:border-t-0" key={date}>
                  <h3 className="px-4 py-2 text-footnote font-medium text-muted-foreground sm:px-5">
                    {date}
                  </h3>

                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-20">时间</TableHead>
                          <TableHead className="w-28">成员</TableHead>
                          <TableHead>标题</TableHead>
                          <TableHead className="w-20">状态</TableHead>
                          <TableHead className="w-36">关联</TableHead>
                          <TableHead className="w-24 text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dayItems.map(item => (
                          <TableRow key={`${item.datasetId}:${item.eventKey}`}>
                            <TableCell className="tabular-nums">{itemTimeLabel(item)}</TableCell>
                            <TableCell>{memberLabel(item, datasets)}</TableCell>
                            <TableCell className="whitespace-normal">
                              <KindBadge item={item} />
                              <span className={cn(item.cancelled && "text-muted-foreground line-through")}>
                                {item.title || "待定"}
                              </span>
                              {item.note ? (
                                <span className="mt-1 block text-caption text-ink-3">{item.note}</span>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              <StateBadge item={item} />
                            </TableCell>
                            <TableCell className="whitespace-normal">
                              <MatchStatus item={item} />
                            </TableCell>
                            <TableCell className="text-right">
                              <RowActions item={item} onDelete={onDelete} onEdit={onEdit} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <ul className="md:hidden">
                    {dayItems.map(item => (
                      <li
                        className="flex flex-col gap-1.5 border-t border-hairline px-4 py-3 first:border-t-0"
                        key={`${item.datasetId}:${item.eventKey}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="text-caption tabular-nums text-ink-3">
                              {itemTimeLabel(item)}
                            </span>
                            <span className="text-footnote font-medium text-foreground">
                              {memberLabel(item, datasets)}
                            </span>
                          </div>
                          <StateBadge item={item} />
                        </div>

                        <p
                          className={cn(
                            "text-footnote leading-snug text-foreground",
                            item.cancelled && "text-muted-foreground line-through",
                          )}
                        >
                          {item.kind ? (
                            <Badge className="me-1.5" size="sm" variant="outline">
                              {CONTENT_TYPE_LABELS[item.kind]}
                            </Badge>
                          ) : null}
                          {item.title || "待定"}
                        </p>

                        {item.note ? (
                          <p className="text-caption text-ink-3">{item.note}</p>
                        ) : null}

                        <div className="flex items-center justify-between gap-2">
                          <MatchStatus className="min-w-0 text-caption" item={item} />
                          <RowActions item={item} onDelete={onDelete} onEdit={onEdit} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
    </section>
  );
}
