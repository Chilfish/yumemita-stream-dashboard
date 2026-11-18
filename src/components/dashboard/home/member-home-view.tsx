import { Link } from "@/lib/router-compat";
import { CopyLinkButton } from "@/components/dashboard/primitives/copy-link-button";
import { HomeCalendar } from "@/components/dashboard/home/home-calendar";
import { HomeLatestStream } from "@/components/dashboard/home/home-latest-stream";
import { HomeRecentStreams } from "@/components/dashboard/home/home-recent-streams";
import { PageHeader } from "@/components/dashboard/primitives/page-header";
import { Panel } from "@/components/dashboard/primitives/panel";
import { Button } from "@/components/ui/button";
import type { DatasetTotals } from "@/lib/aggregate";
import {
  formatDateTime,
  formatDurationLong,
  formatFullDate,
  formatInteger,
  formatPercent,
} from "@/lib/format";
import { galleryPath, streamsPath } from "@/lib/routes";
import { isMemberOnly } from "@/lib/visibility";
import type { BatchManifest, DatasetIndexEntry, StreamSummary } from "@/types/dataset";

interface MemberHomeViewProps {
  dataset: DatasetIndexEntry;
  datasets: DatasetIndexEntry[];
  manifest: BatchManifest;
  rows: StreamSummary[];
  totals: DatasetTotals;
}

interface HeadlineStat {
  label: string;
  value: string;
  unit?: string;
}

/** 手机首屏只放得下四条次级事实，其余从 md 起展开。 */
const MOBILE_NOTE_COUNT = 4;

/** 全站规模：四个最大的数字，先给尺度，再给细节。 */
function HeadlineStats({ items }: { items: HeadlineStat[] }) {
  return (
    <div className="grid grid-cols-2 gap-y-4 border-y border-hairline py-4 md:grid-cols-4">
      {items.map((item, index) => (
        <div
          className={
            index === 0 ? "min-w-0 md:pe-6" : "min-w-0 md:border-s md:border-hairline md:ps-6"
          }
          key={item.label}
        >
          <p className="flex items-baseline text-stat tabular-nums text-foreground">
            <span className="min-w-0 truncate">{item.value}</span>
            {item.unit ? (
              <span className="ml-1 shrink-0 text-caption font-medium text-ink-3">
                {item.unit}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-caption text-muted-foreground">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

export function MemberHomeView({ dataset, datasets, manifest, rows, totals }: MemberHomeViewProps) {
  // 首页大图只放公开场次，会员限定不占主视觉。
  const latest = rows.find(row => !isMemberOnly(row.availability)) ?? null;
  const oldest = rows.at(-1) ?? null;

  const range =
    latest && oldest
      ? `${formatFullDate(oldest.startedAt)} – ${formatFullDate(latest.startedAt)}`
      : null;

  const headline: HeadlineStat[] = [
    { label: "场次", unit: "场", value: formatInteger(totals.streamCount) },
    { label: "弹幕", unit: "条", value: formatInteger(totals.chatTotal) },
    { label: "播放", unit: "次", value: formatInteger(totals.views) },
    { label: "SC", unit: "笔", value: formatInteger(totals.chatByKind.superchat) },
  ];

  const notes = [
    `总时长 ${formatDurationLong(totals.durationSec)}`,
    `场均 ${formatDurationLong(totals.durationSec / Math.max(1, totals.streamCount))}`,
    `${totals.avgChatPerMinute?.toFixed(1) ?? "—"} 条/分`,
    `${formatInteger(totals.watchHours)} 人·时视聴`,
    `${formatInteger(totals.withVstatsCount)} 场有同接数据`,
    `点赞率 ${formatPercent(totals.views > 0 ? (totals.likes / totals.views) * 100 : null, 2)}`,
    `${formatInteger(totals.commentTotal)} 条评论`,
    `${formatInteger(totals.memberOnlyCount)} 场会员限定`,
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-5">
        <PageHeader
          actions={
            <>
              <CopyLinkButton />
              <Button
                render={<Link to={streamsPath(dataset.id)} />}
                size="sm"
                variant="outline"
              >
                全部场次
              </Button>
              <Button
                render={<Link to={galleryPath(dataset.id)} />}
                size="sm"
                variant="outline"
              >
                相册
              </Button>
            </>
          }
          className="border-b-0 pb-0"
          eyebrow={range ?? "活动范围"}
          title={dataset.label}
        >
          {notes.slice(0, MOBILE_NOTE_COUNT).join(" · ")}
          {/* 手机上只留规模四项，其余事实在桌面展开；信息仍在页面上，只是不占首屏。 */}
          <span className="hidden md:inline">
            {" · "}
            {notes.slice(MOBILE_NOTE_COUNT).join(" · ")}
          </span>
        </PageHeader>

        <HeadlineStats items={headline} />
      </div>

      {latest ? (
        <Panel>
          <HomeLatestStream datasetId={dataset.id} rows={rows} stream={latest} />
        </Panel>
      ) : null}

      <HomeRecentStreams datasetId={dataset.id} rows={rows} />

      <HomeCalendar rows={rows} />

      <p className="text-caption text-ink-3">
        数据更新于 {formatDateTime(manifest.generatedAt)} · 范围：{manifest.scope}
      </p>
    </div>
  );
}
