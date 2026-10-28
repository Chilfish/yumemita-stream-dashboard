import { Link } from "react-router";
import { ChartCard } from "@/components/charts/chart-card";
import { StreamShapeChart } from "@/components/charts/stream-shape";
import { CopyLinkButton } from "@/components/dashboard/copy-link-button";
import { HomeContentMix } from "@/components/dashboard/home-content-mix";
import { HomeLatestStream } from "@/components/dashboard/home-latest-stream";
import { HomeMonthPanel } from "@/components/dashboard/home-month-panel";
import { HomeRecentStreams } from "@/components/dashboard/home-recent-streams";
import { HomeTopAuthors } from "@/components/dashboard/home-top-authors";
import { HomeTopWords } from "@/components/dashboard/home-top-words";
import { PageHeader, type Fact } from "@/components/dashboard/page-header";
import { Panel } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import type { DatasetTotals } from "@/lib/aggregate";
import {
  formatDurationLong,
  formatFullDate,
  formatInteger,
  formatPercent,
} from "@/lib/format";
import { streamsPath } from "@/lib/routes";
import type { BatchManifest, DatasetIndexEntry, StreamSummary } from "@/types/dataset";

interface MemberHomeViewProps {
  dataset: DatasetIndexEntry;
  manifest: BatchManifest;
  rows: StreamSummary[];
  totals: DatasetTotals;
}

export function MemberHomeView({ dataset, manifest, rows, totals }: MemberHomeViewProps) {
  const latest = rows[0] ?? null;
  const oldest = rows.at(-1) ?? null;
  const topCurrency = totals.scByCurrency[0];

  const range =
    latest && oldest
      ? `${formatFullDate(oldest.startedAt)} – ${formatFullDate(latest.startedAt)}`
      : null;

  const facts: Fact[] = [
    { label: "场", value: formatInteger(totals.streamCount) },
    { label: "总时长", value: formatDurationLong(totals.durationSec) },
    { label: "弹幕", value: formatInteger(totals.chatTotal) },
    { label: "SC", value: formatInteger(totals.chatByKind.superchat) },
    { label: "播放", value: formatInteger(totals.views) },
    { label: "人·时视聴", value: formatInteger(totals.watchHours) },
  ];

  const hints = [
    `${formatInteger(totals.memberOnlyCount)} 场会员限定`,
    `场均 ${formatDurationLong(totals.durationSec / Math.max(1, totals.streamCount))}`,
    `${totals.avgChatPerMinute?.toFixed(1) ?? "—"} 条/分`,
    topCurrency
      ? `SC ${topCurrency.currency} ${formatInteger(topCurrency.amount)}`
      : "无 SC 记录",
    `${formatInteger(totals.withVstatsCount)} 场有 VSTATS`,
    `点赞率 ${formatPercent(totals.views > 0 ? (totals.likes / totals.views) * 100 : null, 2)}`,
    `${formatInteger(totals.commentTotal)} 条评论`,
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        actions={
          <>
            <CopyLinkButton />
            <Button render={<Link to={streamsPath(dataset.id)} />} size="sm">
              查看全部场次
            </Button>
          </>
        }
        eyebrow={range ? `最近怎么样 · ${range}` : "最近怎么样"}
        facts={facts}
        title={dataset.label}
      >
        {hints.join(" · ")}
      </PageHeader>

      {latest ? (
        <Panel>
          <div className="grid grid-cols-1 divide-y divide-hairline lg:grid-cols-[1.85fr_1fr] lg:divide-x lg:divide-y-0">
            <HomeLatestStream
              datasetId={dataset.id}
              rows={rows}
              stream={latest}
              totals={totals}
            />
            <HomeMonthPanel rows={rows} />
          </div>
        </Panel>
      ) : null}

      <HomeRecentStreams datasetId={dataset.id} rows={rows} />

      <Panel>
        <div className="grid grid-cols-1 divide-y divide-hairline lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <HomeContentMix rows={rows} />
          <HomeTopWords words={totals.topWords} />
        </div>
        <HomeTopAuthors authors={totals.topAuthors} />
      </Panel>

      {totals.streamShape ? (
        <ChartCard
          description={`把 ${totals.streamShape.streams} 场按直播进度对齐后平均：纵轴为相对该场自身弹幕浓度的倍数（×1 = 该场均值），阴影为 25–75 分位。`}
          title="典型节奏曲线"
        >
          <StreamShapeChart shape={totals.streamShape} />
        </ChartCard>
      ) : null}

      <p className="text-caption text-ink-3">
        数据生成于 {manifest.generatedAt}；同接 / 视聴时间 / 播放优先取 VSTATS，
        {totals.streamCount - totals.withVstatsCount} 场无 VSTATS，相关数字显示「—」。范围：
        {manifest.scope}
      </p>
    </div>
  );
}
