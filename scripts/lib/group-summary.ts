/**
 * 组级精简数据的生成规则。
 *
 * 组首页只需要「成员全期汇总 + 最近 40 天按日桶 + 每位成员最新一场 + 最近若干场」，
 * 全组相册才需要全部精简行。两个文件都在发布时由 manifest 派生，
 * 页面不再为了摘要去拉五份完整 manifest。
 */
import { shiftDateKey, toGroupStream } from "../../src/lib/group.ts";
import {
  GROUP_GALLERY_SCHEMA,
  GROUP_RECENT_LIMIT,
  GROUP_SUMMARY_SCHEMA,
  type GroupDayStat,
  type GroupGalleryFile,
  type GroupMemberStat,
  type GroupStreamSummary,
  type GroupSummaryFile,
} from "../../src/types/group.ts";
import type { StreamSummary } from "./dataset-manifest.ts";

/** 当前月最多 31 天，留一周余量；再早的日期不可能落进近 7 天 / 本月窗口。 */
const DAY_WINDOW = 40;

export interface GroupManifestSource {
  id: string;
  streams: StreamSummary[];
}

function sortNewestFirst<T extends { startedAt: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function memberStat(datasetId: string, rows: GroupStreamSummary[]): GroupMemberStat {
  let chatTotal = 0;
  let superchats = 0;
  let durationSec = 0;
  let weightedConcurrent = 0;
  let concurrentDuration = 0;

  for (const row of rows) {
    chatTotal += row.chatTotal;
    superchats += row.superchats;
    durationSec += row.durationSec ?? 0;
    if (row.avgConcurrent != null && row.durationSec) {
      weightedConcurrent += row.avgConcurrent * row.durationSec;
      concurrentDuration += row.durationSec;
    }
  }

  return {
    datasetId,
    streamCount: rows.length,
    chatTotal,
    superchats,
    durationSec,
    avgConcurrent: concurrentDuration > 0 ? weightedConcurrent / concurrentDuration : null,
  };
}

/**
 * 只保留最近 40 天有场次的日期桶。窗口按“现在”算，所以不能把周/月数字写死；
 * 但当前月最多 31 天，40 天足够覆盖，客户端求和时不会缺日期。
 */
function dayStats(datasetId: string, rows: GroupStreamSummary[]): GroupDayStat[] {
  const buckets = new Map<string, { streams: number; chat: number }>();
  for (const row of rows) {
    if (!isDateKey(row.date)) continue;
    const bucket = buckets.get(row.date) ?? { streams: 0, chat: 0 };
    bucket.streams += 1;
    bucket.chat += row.chatTotal;
    buckets.set(row.date, bucket);
  }

  const latest = rows.find(row => isDateKey(row.date))?.date;
  if (!latest) return [];
  const minDate = shiftDateKey(latest, -DAY_WINDOW);

  return [...buckets.entries()]
    .filter(([date]) => date >= minDate)
    .map(([date, bucket]) => ({
      datasetId,
      date,
      streams: bucket.streams,
      chat: bucket.chat,
    }));
}

export function buildGroupSummary(
  manifests: GroupManifestSource[],
  generatedAt: string,
): GroupSummaryFile {
  const all: GroupStreamSummary[] = [];
  const latest: GroupStreamSummary[] = [];
  const members: GroupMemberStat[] = [];
  const days: GroupDayStat[] = [];

  for (const manifest of manifests) {
    const rows = sortNewestFirst(
      manifest.streams.map(stream => toGroupStream(manifest.id, stream)),
    );
    const newest = rows[0];
    if (newest) latest.push(newest);
    all.push(...rows);
    members.push(memberStat(manifest.id, rows));
    days.push(...dayStats(manifest.id, rows));
  }

  all.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  days.sort((a, b) => b.date.localeCompare(a.date) || a.datasetId.localeCompare(b.datasetId));

  return {
    schema: GROUP_SUMMARY_SCHEMA,
    generatedAt,
    members,
    days,
    latest: sortNewestFirst(latest),
    recent: all.slice(0, GROUP_RECENT_LIMIT),
  };
}

export function buildGroupGallery(
  manifests: GroupManifestSource[],
  generatedAt: string,
): GroupGalleryFile {
  const streams = manifests.flatMap(manifest =>
    manifest.streams.map(stream => toGroupStream(manifest.id, stream)),
  );
  streams.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));

  return { schema: GROUP_GALLERY_SCHEMA, generatedAt, streams };
}
