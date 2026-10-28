import type { LucideIcon } from "lucide-react";
import {
  ExternalLink,
  Eye,
  Heart,
  MessageSquare,
  MessagesSquare,
  ThumbsUp,
  Timer,
  Users,
} from "lucide-react";
import { ChatDensity } from "@/components/charts/chat-density";
import { ChartCard, EmptyChart } from "@/components/charts/chart-card";
import { TenMinuteBars } from "@/components/charts/ten-minute-bars";
import { TopBars } from "@/components/charts/top-bars";
import { CopyLinkButton } from "@/components/dashboard/copy-link-button";
import { ScTable } from "@/components/dashboard/sc-table";
import { StreamPicker } from "@/components/dashboard/stream-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardPanel } from "@/components/ui/card";
import type { StreamRow } from "@/lib/aggregate";
import type { StreamSummary } from "@/types/dataset";
import {
  formatDateTime,
  formatDuration,
  formatDurationLong,
  formatFullDate,
  formatInteger,
  formatPercent,
  formatTime,
} from "@/lib/format";

interface StreamViewProps {
  rows: StreamSummary[];
  row: StreamRow;
  onSelect: (videoId: string) => void;
}

interface StatProps {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
}

function Stat({ label, value, hint, icon: Icon }: StatProps) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        {Icon ? <Icon aria-hidden="true" className="size-3 text-muted-foreground" /> : null}
      </div>
      <p className="mt-1 truncate font-heading font-semibold text-lg">{value}</p>
      {hint ? <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function StreamView({ rows, row, onSelect }: StreamViewProps) {
  const { pack, summary } = row;
  const memberOnly = pack.video.availability === "subscriber_only";
  const superchatCount = pack.chat.paid.superchats.length;
  const topWords = pack.chat.topWords.slice(0, 16).map(word => ({
    label: word.word,
    value: word.count,
    hint: `${word.count} 次`,
  }));
  const topAuthors = pack.chat.topAuthors.slice(0, 12).map(author => ({
    label: author.author,
    value: author.messages,
    hint: `${author.messages} 条 · SC ${author.superchats} 笔`,
  }));
  const badges = Object.entries(pack.chat.badges)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ label: name, value: count, hint: `${count} 条` }));
  const comments = pack.comments?.items.slice(0, 20) ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="min-w-0">
        <StreamPicker onSelect={onSelect} rows={rows} selectedId={summary.videoId} />
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardPanel className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{formatFullDate(summary.startedAt)}</Badge>
                  <Badge variant="outline">{formatDuration(summary.durationSec)}</Badge>
                  {memberOnly ? <Badge variant="warning">会员限定</Badge> : null}
                  {pack.vstats ? (
                    <Badge variant="success">VSTATS</Badge>
                  ) : (
                    <Badge variant="outline">无 VSTATS</Badge>
                  )}
                </div>
                <h2 className="mt-2 font-heading font-semibold text-lg leading-snug">
                  {summary.title}
                </h2>
                <p className="mt-1 text-muted-foreground text-xs">
                  {formatDateTime(summary.startedAt)} – {formatTime(summary.endedAt)} JST ·{" "}
                  {summary.videoId}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  render={<a href={summary.url} rel="noreferrer" target="_blank" />}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <ExternalLink aria-hidden="true" />
                  YouTube
                </Button>
                <CopyLinkButton />
              </div>
            </div>
          </CardPanel>
        </Card>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat
            hint={pack.vstats?.maxConcurrentAt ?? undefined}
            icon={Users}
            label="平均 / 最大同接"
            value={`${formatInteger(pack.vstats?.avgConcurrent ?? null)} / ${formatInteger(pack.vstats?.maxConcurrent ?? null)}`}
          />
          <Stat
            hint="VSTATS 口径"
            icon={Timer}
            label="视聴时间"
            value={
              pack.vstats?.watchTimeHours != null
                ? `${formatInteger(pack.vstats.watchTimeHours)} 人·时`
                : "—"
            }
          />
          <Stat
            hint={`点赞率 ${formatPercent(pack.derived.likesPer1000Views != null ? pack.derived.likesPer1000Views / 10 : null, 2)}`}
            icon={Eye}
            label="播放"
            value={formatInteger(pack.vstats?.views ?? pack.video.snapshot.views)}
          />
          <Stat
            hint={pack.vstats?.likes != null ? "VSTATS 快照" : "抓取时点"}
            icon={Heart}
            label="点赞"
            value={formatInteger(pack.vstats?.likes ?? pack.video.snapshot.likes)}
          />
          <Stat
            hint={`${pack.chat.density.perMinuteMean?.toFixed(1) ?? "—"} 条/分`}
            icon={MessageSquare}
            label="弹幕"
            value={formatInteger(pack.chat.total)}
          />
          <Stat
            hint={`付费占比 ${formatPercent(pack.chat.paid.paidSharePct)}`}
            icon={Users}
            label="发言人数"
            value={formatInteger(pack.chat.uniqueAuthors)}
          />
          <Stat
            hint={`${pack.derived.scPerHour?.toFixed(2) ?? "—"} 笔/小时`}
            icon={MessagesSquare}
            label="SC"
            value={`${superchatCount} 笔`}
          />
          <Stat
            hint={`置顶 ${pack.comments?.pinned ?? 0}`}
            icon={ThumbsUp}
            label="评论"
            value={formatInteger(pack.comments?.total ?? null)}
          />
        </div>

        <ChartCard
          description={`覆盖 ${pack.chat.coveragePct?.toFixed(1) ?? "—"}%；红条为逐分钟 SC 笔数。悬停查看该分钟数值。`}
          title="逐分钟弹幕"
        >
          <ChatDensity row={row} />
        </ChartCard>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard description="每 10 分钟汇总；红点表示该段有 SC。" title="弹幕时间分布">
            <TenMinuteBars row={row} />
          </ChartCard>
          <ChartCard description="本场 Top 词；日语分词，不合并表记揺れ。" title="高频词">
            <TopBars items={topWords} />
          </ChartCard>
        </div>

        <ChartCard
          description={`共 ${superchatCount} 笔；金额按原文表记，不换算汇率。`}
          title="SC 一览"
        >
          <ScTable row={row} />
        </ChartCard>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard description="本场 Top 20 发言者（Top 20 之外未计入）。" title="发言者">
            <TopBars items={topAuthors} labelWidth={128} />
          </ChartCard>
          <ChartCard description="按弹幕携带的徽章统计。" title="徽章分布">
            <TopBars items={badges} />
          </ChartCard>
        </div>

        <ChartCard
          description={`抓取到 ${pack.comments?.total ?? 0} 条；置顶 ${pack.comments?.pinned ?? 0}。`}
          title="评论区"
        >
          {comments.length === 0 ? (
            <EmptyChart height={140} message="本场没有抓取到评论" />
          ) : (
            <ul className="flex flex-col divide-y">
              {comments.map(comment => (
                <li
                  className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0"
                  key={`${comment.at}-${comment.author}-${comment.text.slice(0, 12)}`}
                >
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="font-medium">{comment.author ?? "（未知）"}</span>
                    <span className="text-muted-foreground">赞 {comment.likes}</span>
                    {comment.pinned ? <Badge variant="warning">置顶</Badge> : null}
                    {comment.byUploader ? <Badge variant="info">主播</Badge> : null}
                  </div>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed">{comment.text}</p>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>

        <p className="text-muted-foreground text-[11px]">
          本场时长 {formatDurationLong(summary.durationSec)}；数据包生成于 {pack.generatedAt}。
        </p>
      </div>
    </div>
  );
}
