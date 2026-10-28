import { useMemo } from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { CHART_COLORS } from "@/lib/chart-colors";
import { MultiLineChart } from "@/components/charts/multi-line-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyLinkButton } from "@/components/dashboard/copy-link-button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
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
} from "@/lib/format";

const MAX_SELECTED = 4;

interface CompareViewProps {
  rows: StreamRow[];
  selectedIds: string[];
  onToggle: (videoId: string) => void;
}

interface Metric {
  key: string;
  label: string;
  value: (row: StreamRow) => number | null;
  format: (value: number | null) => string;
  higherIsBetter?: boolean;
}

const METRICS: Metric[] = [
  { key: "duration", label: "时长", value: row => row.summary.durationSec, format: value => formatDuration(value) },
  { key: "avg", label: "平均同接", value: row => row.pack.vstats?.avgConcurrent ?? null, format: formatInteger },
  { key: "max", label: "最大同接", value: row => row.pack.vstats?.maxConcurrent ?? null, format: formatInteger },
  { key: "watch", label: "视聴时间（人·时）", value: row => row.pack.vstats?.watchTimeHours ?? null, format: formatInteger },
  { key: "views", label: "播放", value: row => row.pack.vstats?.views ?? row.pack.video.snapshot.views, format: formatInteger },
  {
    key: "likeRate",
    label: "点赞率",
    value: row => (row.pack.derived.likesPer1000Views != null ? row.pack.derived.likesPer1000Views / 10 : null),
    format: value => formatPercent(value, 2),
  },
  { key: "chat", label: "弹幕", value: row => row.pack.chat.total, format: formatInteger },
  { key: "authors", label: "发言人数", value: row => row.pack.chat.uniqueAuthors, format: formatInteger },
  {
    key: "chatPer1000",
    label: "每千同接弹幕",
    value: row => row.pack.derived.chatPer1000AvgViewers,
    format: value => (value == null ? "—" : formatInteger(Math.round(value))),
  },
  { key: "sc", label: "SC 笔数", value: row => row.pack.chat.paid.superchats.length, format: formatInteger },
  { key: "comments", label: "评论", value: row => row.pack.comments?.total ?? null, format: formatInteger },
];

export function CompareView({ rows, selectedIds, onToggle }: CompareViewProps) {
  const selected = useMemo(
    () =>
      selectedIds
        .map(id => rows.find(row => row.summary.videoId === id))
        .filter((row): row is StreamRow => row != null),
    [rows, selectedIds],
  );

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="self-start">
        <CardHeader>
          <CardTitle>
            选择对比场次
            <span className="ml-2 font-normal text-muted-foreground text-sm">
              {selected.length}/{MAX_SELECTED}
            </span>
          </CardTitle>
          <CardAction>
            <CopyLinkButton />
          </CardAction>
        </CardHeader>
        <CardPanel className="pt-0">
          <ScrollArea className="h-[560px] rounded-lg border">
            <div className="flex flex-col gap-0.5 p-1.5">
              {rows.map(row => {
                const checked = selectedIds.includes(row.summary.videoId);
                const disabled = !checked && selectedIds.length >= MAX_SELECTED;
                return (
                  <Label
                    className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-accent data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50"
                    data-disabled={disabled}
                    key={row.summary.videoId}
                  >
                    <Checkbox
                      checked={checked}
                      className="mt-0.5"
                      disabled={disabled}
                      onCheckedChange={() => onToggle(row.summary.videoId)}
                    />
                    <span className="min-w-0">
                      <span className="block font-mono text-[11px] text-muted-foreground">
                        {formatDate(row.summary.startedAt)}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs leading-snug">
                        {row.summary.title}
                      </span>
                    </span>
                  </Label>
                );
              })}
            </div>
          </ScrollArea>
        </CardPanel>
      </Card>

      <div className="flex min-w-0 flex-col gap-4">
        <ChartCard
          description="按开播后分钟对齐；不同时长的场次在同一时间轴上比较每分钟弹幕量。"
          title="逐分钟弹幕对比"
        >
          {selected.length >= 2 ? (
            <MultiLineChart
              ariaLabel="所选直播的逐分钟弹幕对比"
              series={selected.map((row, index) => ({
                id: row.summary.videoId,
                label: `${formatDate(row.summary.startedAt)} ${row.summary.title}`,
                values: row.pack.chat.density.perMinute,
                color: CHART_COLORS[index % CHART_COLORS.length],
              }))}
            />
          ) : (
            <div className="flex h-64 items-center justify-center text-muted-foreground text-sm">
              至少选择 2 场
            </div>
          )}
        </ChartCard>

        <Card>
          <CardHeader>
            <CardTitle>指标对比</CardTitle>
          </CardHeader>
          <CardPanel className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">指标</TableHead>
                  {selected.map(row => (
                    <TableHead className="min-w-32" key={row.summary.videoId}>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {formatDate(row.summary.startedAt)}
                        </span>
                        <span className="max-w-48 truncate">{row.summary.title}</span>
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {METRICS.map(metric => {
                  const values = selected.map(metric.value);
                  const numeric = values.filter((value): value is number => value != null);
                  const best = numeric.length > 0 ? Math.max(...numeric) : null;
                  return (
                    <TableRow key={metric.key}>
                      <TableCell className="text-muted-foreground text-xs">{metric.label}</TableCell>
                      {selected.map((row, index) => {
                        const value = values[index];
                        const isBest =
                          value != null && best != null && value === best && numeric.length > 1;
                        return (
                          <TableCell
                            className={isBest ? "font-heading font-semibold" : "font-mono text-xs"}
                            key={row.summary.videoId}
                          >
                            {isBest ? (
                              <span className="inline-flex items-center gap-1">
                                {metric.format(value)}
                                <Badge className="text-[10px]" variant="success">
                                  最高
                                </Badge>
                              </span>
                            ) : (
                              metric.format(value)
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardPanel>
        </Card>
      </div>
    </div>
  );
}
