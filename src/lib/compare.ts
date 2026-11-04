import { classifyTitle } from "@/lib/classify";
import { MIN_COMPARE_SAMPLE } from "@/lib/compare-params";
import type {
  CompareBucket,
  CompareMemberStat,
  CompareMetricKey,
  CompareMetricSeries,
  CompareParams,
  GroupCompareView,
} from "@/types/compare";
import type { DatasetIndexEntry } from "@/types/dataset";

export interface CompareStreamRow {
  datasetId: string;
  title: string | null;
  date: string | null;
  startedAt: string | null;
  durationSec: number | null;
  avgConcurrent: number | null;
  chatTotal: number;
  superchats: number;
  commentsCaptured: number | null;
}

const JST_MONTH = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
});

/** 优先用 JST 自然日（`date`），缺失时从 `startedAt` 反推。 */
export function monthKeyOf(row: Pick<CompareStreamRow, "date" | "startedAt">): string | null {
  if (row.date && /^\d{4}-\d{2}/.test(row.date)) return row.date.slice(0, 7);
  if (!row.startedAt) return null;

  const timestamp = Date.parse(row.startedAt);
  if (!Number.isFinite(timestamp)) return null;

  const parts = JST_MONTH.formatToParts(new Date(timestamp));
  const year = parts.find(part => part.type === "year")?.value;
  const month = parts.find(part => part.type === "month")?.value;
  return year && month ? `${year}-${month}` : null;
}

function bucketKey(memberId: string, month: string, type: string): string {
  return `${memberId}\u0000${month}\u0000${type}`;
}

/** 逐场聚合到「成员 × 月份 × 类型」；同时写 `all` 与具体类型两份。 */
export function buildCompareBuckets(rows: CompareStreamRow[]): CompareBucket[] {
  const buckets = new Map<string, CompareBucket>();

  for (const row of rows) {
    const month = monthKeyOf(row);
    if (!month) continue;

    const type = classifyTitle(row.title).key;
    const durationSec = row.durationSec ?? 0;
    const hasConcurrent =
      row.avgConcurrent != null && Number.isFinite(row.avgConcurrent) && row.durationSec != null;

    for (const bucketType of [type, "all"] as const) {
      const key = bucketKey(row.datasetId, month, bucketType);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          memberId: row.datasetId,
          month,
          type: bucketType,
          streams: 0,
          durationSec: 0,
          chatTotal: 0,
          superchats: 0,
          commentsCaptured: 0,
          commentsStreams: 0,
          concurrentWeighted: 0,
          concurrentDuration: 0,
        };
        buckets.set(key, bucket);
      }

      bucket.streams += 1;
      bucket.durationSec += durationSec;
      bucket.chatTotal += row.chatTotal;
      bucket.superchats += row.superchats;
      if (row.commentsCaptured != null) {
        bucket.commentsCaptured += row.commentsCaptured;
        bucket.commentsStreams += 1;
      }
      if (hasConcurrent) {
        bucket.concurrentWeighted += (row.avgConcurrent ?? 0) * durationSec;
        bucket.concurrentDuration += durationSec;
      }
    }
  }

  return [...buckets.values()].sort(
    (left, right) =>
      left.month.localeCompare(right.month) ||
      left.memberId.localeCompare(right.memberId) ||
      left.type.localeCompare(right.type),
  );
}

function monthValue(bucket: CompareBucket | undefined, key: CompareMetricKey): number | null {
  if (!bucket) return key === "streams" ? 0 : null;

  switch (key) {
    case "streams":
      return bucket.streams;
    case "avgConcurrent":
      return bucket.concurrentDuration > 0
        ? bucket.concurrentWeighted / bucket.concurrentDuration
        : null;
    case "chatPerMinute":
      return bucket.durationSec > 0 ? bucket.chatTotal / (bucket.durationSec / 60) : null;
    case "scPerHour":
      return bucket.durationSec > 0 ? bucket.superchats / (bucket.durationSec / 3600) : null;
    default:
      return null;
  }
}

const SERIES_COPY: Record<CompareMetricKey, { label: string; unit: string }> = {
  streams: { label: "场次", unit: "场" },
  avgConcurrent: { label: "平均同接", unit: "人" },
  chatPerMinute: { label: "弹幕密度", unit: "条/分" },
  scPerHour: { label: "SC 强度", unit: "条/时" },
};

/** 场次为 0 视为「这个月没数据」，其余指标只认非空值。 */
export function metricHasValue(
  key: CompareMetricKey,
  value: number | null | undefined,
): boolean {
  if (value == null || !Number.isFinite(value)) return false;
  return key === "streams" ? value > 0 : true;
}

/**
 * 裁掉首尾没有任何成员数据的月份。
 * 同接等稀疏指标只在最近几个月有值，保留空月份会把有数据的部分挤到最右侧。
 */
export function trimmedMonthRange(
  months: string[],
  valuesByMember: Record<string, (number | null)[]>,
  key: CompareMetricKey,
): { start: number; end: number } {
  let start = -1;
  let end = -1;

  for (let index = 0; index < months.length; index += 1) {
    const hasValue = Object.values(valuesByMember).some(series =>
      metricHasValue(key, series[index]),
    );
    if (!hasValue) continue;
    if (start === -1) start = index;
    end = index;
  }

  return start === -1
    ? { start: 0, end: months.length - 1 }
    : { start, end };
}

/** 均匀分布月份刻度，并保证最后一个刻度不会紧贴前一个。 */
export function monthTickIndices(length: number, maxTicks = 6): number[] {
  if (length <= 0) return [];
  if (length <= maxTicks) {
    return Array.from({ length }, (_, index) => index);
  }

  const step = Math.max(1, Math.ceil((length - 1) / (maxTicks - 1)));
  const indices: number[] = [];
  for (let index = 0; index < length; index += step) indices.push(index);

  const last = length - 1;
  if (indices.at(-1) !== last) {
    if (last - (indices.at(-1) ?? 0) < step) indices.pop();
    indices.push(last);
  }

  return indices;
}

export function buildCompareView(
  buckets: CompareBucket[],
  datasets: DatasetIndexEntry[],
  params: CompareParams,
): GroupCompareView {
  const datasetById = new Map(datasets.map(dataset => [dataset.id, dataset]));
  const memberIds = [...new Set(params.members.length > 0 ? params.members : datasets.map(d => d.id))]
    .filter(id => datasetById.has(id));

  const allMonths = [...new Set(buckets.map(bucket => bucket.month))].sort();
  const months =
    params.months === "all" ? allMonths : allMonths.slice(-params.months);
  const monthSet = new Set(months);
  const type = params.type ?? "all";

  const byMemberMonth = new Map<string, CompareBucket>();
  for (const bucket of buckets) {
    if (bucket.type !== type || !monthSet.has(bucket.month)) continue;
    byMemberMonth.set(`${bucket.memberId}\u0000${bucket.month}`, bucket);
  }

  const members: CompareMemberStat[] = memberIds.map((id) => {
    const dataset = datasetById.get(id);

    let streams = 0;
    let durationSec = 0;
    let chatTotal = 0;
    let superchats = 0;
    let commentsCaptured = 0;
    let commentsStreams = 0;
    let concurrentWeighted = 0;
    let concurrentDuration = 0;

    for (const month of months) {
      const bucket = byMemberMonth.get(`${id}\u0000${month}`);
      if (!bucket) continue;
      streams += bucket.streams;
      durationSec += bucket.durationSec;
      chatTotal += bucket.chatTotal;
      superchats += bucket.superchats;
      commentsCaptured += bucket.commentsCaptured;
      commentsStreams += bucket.commentsStreams;
      concurrentWeighted += bucket.concurrentWeighted;
      concurrentDuration += bucket.concurrentDuration;
    }

    return {
      id,
      label: dataset?.label ?? id,
      color: dataset?.color ?? null,
      streams,
      durationSec,
      avgConcurrent:
        concurrentDuration > 0 ? concurrentWeighted / concurrentDuration : null,
      chatPerMinute: durationSec > 0 ? chatTotal / (durationSec / 60) : null,
      scPerHour: durationSec > 0 ? superchats / (durationSec / 3600) : null,
      commentsPerStream: commentsStreams > 0 ? commentsCaptured / commentsStreams : null,
      sampleSufficient: streams >= MIN_COMPARE_SAMPLE,
    };
  });

  const series: CompareMetricSeries[] = (
    Object.keys(SERIES_COPY) as CompareMetricKey[]
  ).map((key) => ({
    key,
    ...SERIES_COPY[key],
    values: Object.fromEntries(
      memberIds.map(id => [
        id,
        months.map(month => monthValue(byMemberMonth.get(`${id}\u0000${month}`), key)),
      ]),
    ),
  }));

  const totals = { streams: 0, durationSec: 0, chatTotal: 0, superchats: 0 };
  for (const id of memberIds) {
    for (const month of months) {
      const bucket = byMemberMonth.get(`${id}\u0000${month}`);
      if (!bucket) continue;
      totals.streams += bucket.streams;
      totals.durationSec += bucket.durationSec;
      totals.chatTotal += bucket.chatTotal;
      totals.superchats += bucket.superchats;
    }
  }

  return {
    months,
    members,
    series,
    totals,
    sampleMin: MIN_COMPARE_SAMPLE,
  };
}
