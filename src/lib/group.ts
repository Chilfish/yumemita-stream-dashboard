import type { BatchManifest, DatasetIndexEntry, StreamSummary } from "@/types/dataset";
import type {
  GroupDayStat,
  GroupMemberStat,
  GroupStreamSummary,
  GroupSummaryFile,
} from "@/types/group";

export const DEFAULT_MEMBER_COLOR = "#b8461f";

/** 跨成员的一行：精简场次字段 + 它属于谁，页面据此拼链接、取封面、上成员色。 */
export interface GroupStreamRow extends GroupStreamSummary {
  memberLabel: string;
  memberColor: string;
}

export interface GroupMemberSummary {
  dataset: DatasetIndexEntry;
  latest: GroupStreamRow | null;
  streamCount: number;
  chatTotal: number;
  superchats: number;
  durationSec: number;
  /** 最近 7 天（含今天，JST）的场次与新弹幕。 */
  weekStreams: number;
  weekChat: number;
  /** 当前自然月（JST）的场次。 */
  monthStreams: number;
  /** 按场次时长加权的平均同接；没有 VSTATS 的场次不参与。 */
  avgConcurrent: number | null;
}

export interface GroupTotals {
  streamCount: number;
  chatTotal: number;
  superchats: number;
  durationSec: number;
  weekStreams: number;
  weekChat: number;
  monthStreams: number;
}

export interface GroupData {
  rows: GroupStreamRow[];
  members: GroupMemberSummary[];
  totals: GroupTotals;
}

const JST_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 今天的 JST 自然日，`YYYY-MM-DD`。 */
export function jstDateKey(now: Date = new Date()): string {
  return JST_DATE.format(now);
}

/** 在 `YYYY-MM-DD` 上加减天数（按 UTC 计算，避免本地时区再次偏移）。 */
export function shiftDateKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 最近 7 天的起点（含今天）：今天减 6 天。 */
export function weekStartKey(now: Date = new Date()): string {
  return shiftDateKey(jstDateKey(now), -6);
}

function streamDateKey(row: { date: string }): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : null;
}

/** 逐行聚合只需要这几个字段；manifest 兜底与按日桶两条路径共用同一个求和逻辑。 */
interface RowStat {
  date: string;
  chatTotal: number;
  superchats: number;
  durationSec: number | null;
  avgConcurrent: number | null;
}

function summarizeMember(
  dataset: DatasetIndexEntry,
  stats: RowStat[],
  latest: GroupStreamRow | null,
  weekStart: string,
  monthKey: string,
): GroupMemberSummary {
  let chatTotal = 0;
  let superchats = 0;
  let durationSec = 0;
  let weekStreams = 0;
  let weekChat = 0;
  let monthStreams = 0;
  let weightedConcurrent = 0;
  let concurrentDuration = 0;

  for (const row of stats) {
    chatTotal += row.chatTotal ?? 0;
    superchats += row.superchats ?? 0;
    durationSec += row.durationSec ?? 0;

    const date = streamDateKey(row);
    if (date && date >= weekStart) {
      weekStreams += 1;
      weekChat += row.chatTotal ?? 0;
    }
    if (date && date.slice(0, 7) === monthKey) monthStreams += 1;

    if (row.avgConcurrent != null && row.durationSec) {
      weightedConcurrent += row.avgConcurrent * row.durationSec;
      concurrentDuration += row.durationSec;
    }
  }

  return {
    dataset,
    latest,
    streamCount: stats.length,
    chatTotal,
    superchats,
    durationSec,
    weekStreams,
    weekChat,
    monthStreams,
    avgConcurrent: concurrentDuration > 0 ? weightedConcurrent / concurrentDuration : null,
  };
}

function totalsOf(members: GroupMemberSummary[]): GroupTotals {
  const totals: GroupTotals = {
    streamCount: 0,
    chatTotal: 0,
    superchats: 0,
    durationSec: 0,
    weekStreams: 0,
    weekChat: 0,
    monthStreams: 0,
  };

  for (const member of members) {
    totals.streamCount += member.streamCount;
    totals.chatTotal += member.chatTotal;
    totals.superchats += member.superchats;
    totals.durationSec += member.durationSec;
    totals.weekStreams += member.weekStreams;
    totals.weekChat += member.weekChat;
    totals.monthStreams += member.monthStreams;
  }

  return totals;
}

function sortRows<T extends { startedAt: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}

function attachMember(
  dataset: DatasetIndexEntry,
  row: GroupStreamSummary,
): GroupStreamRow {
  return {
    ...row,
    memberLabel: dataset.label,
    memberColor: dataset.color ?? DEFAULT_MEMBER_COLOR,
  };
}

/**
 * 首页只加载 `group-summary.json`：members 是全期汇总，days 只覆盖最近 40 天，
 * 用来按「现在」计算近 7 天 / 本月窗口；latest/recent 负责渲染。
 */
export function buildGroupDataFromSummary(
  datasets: DatasetIndexEntry[],
  summary: GroupSummaryFile,
  now: Date = new Date(),
): GroupData {
  const weekStart = weekStartKey(now);
  const monthKey = jstDateKey(now).slice(0, 7);
  const datasetById = new Map(datasets.map(dataset => [dataset.id, dataset]));

  const statsById = new Map<string, GroupMemberStat>();
  for (const stat of summary.members) statsById.set(stat.datasetId, stat);

  const daysById = new Map<string, GroupDayStat[]>();
  for (const day of summary.days) {
    const bucket = daysById.get(day.datasetId);
    if (bucket) bucket.push(day);
    else daysById.set(day.datasetId, [day]);
  }

  const latestById = new Map<string, GroupStreamSummary>();
  for (const row of summary.latest) {
    if (!latestById.has(row.datasetId)) latestById.set(row.datasetId, row);
  }

  const members: GroupMemberSummary[] = [];
  for (const dataset of datasets) {
    // 组级文件没有这个成员：按加载失败处理，交给 useGroupData 回退 manifest。
    const stat = statsById.get(dataset.id);
    if (!stat) continue;

    let weekStreams = 0;
    let weekChat = 0;
    let monthStreams = 0;
    for (const day of daysById.get(dataset.id) ?? []) {
      const date = streamDateKey(day);
      if (!date) continue;
      if (date >= weekStart) {
        weekStreams += day.streams;
        weekChat += day.chat;
      }
      if (date.slice(0, 7) === monthKey) monthStreams += day.streams;
    }

    const latestRow = latestById.get(dataset.id);
    members.push({
      dataset,
      latest: latestRow ? attachMember(dataset, latestRow) : null,
      streamCount: stat.streamCount,
      chatTotal: stat.chatTotal,
      superchats: stat.superchats,
      durationSec: stat.durationSec,
      weekStreams,
      weekChat,
      monthStreams,
      avgConcurrent: stat.avgConcurrent,
    });
  }

  const rows = summary.recent
    .map(row => {
      const dataset = datasetById.get(row.datasetId);
      return dataset ? attachMember(dataset, row) : null;
    })
    .filter((row): row is GroupStreamRow => row !== null);

  return { members, rows: sortRows(rows), totals: totalsOf(members) };
}

/** 相册走 `group-gallery.json`：需要全部场次，再按成员分组聚合。 */
export function buildGroupDataFromStreams(
  datasets: DatasetIndexEntry[],
  streams: GroupStreamSummary[],
  now: Date = new Date(),
): GroupData {
  const weekStart = weekStartKey(now);
  const monthKey = jstDateKey(now).slice(0, 7);
  const datasetById = new Map(datasets.map(dataset => [dataset.id, dataset]));

  const byDataset = new Map<string, GroupStreamSummary[]>();
  for (const stream of streams) {
    const dataset = datasetById.get(stream.datasetId);
    if (!dataset) continue;
    const bucket = byDataset.get(stream.datasetId);
    if (bucket) bucket.push(stream);
    else byDataset.set(stream.datasetId, [stream]);
  }

  const rows: GroupStreamRow[] = [];
  const members: GroupMemberSummary[] = [];

  for (const dataset of datasets) {
    // 没有场次的成员也要留在 members 里：组首页的 idle 列表靠它渲染。
    const source = byDataset.get(dataset.id) ?? [];
    const memberRows = sortRows(source).map(row => attachMember(dataset, row));
    const stats: RowStat[] = memberRows.map(row => ({
      date: row.date,
      chatTotal: row.chatTotal,
      superchats: row.superchats,
      durationSec: row.durationSec,
      avgConcurrent: row.avgConcurrent,
    }));

    members.push(
      summarizeMember(dataset, stats, memberRows[0] ?? null, weekStart, monthKey),
    );
    rows.push(...memberRows);
  }

  return { members, rows: sortRows(rows), totals: totalsOf(members) };
}

/**
 * 把各成员的 manifest 合成一份组级视图（远端还没有 group-summary.json 时的兜底）。
 * 只读 summary，不碰 datapack。
 */
export function buildGroupData(
  datasets: DatasetIndexEntry[],
  manifests: Map<string, BatchManifest>,
  now: Date = new Date(),
): GroupData {
  const streams: GroupStreamSummary[] = [];

  // 加载失败的成员整体跳过；加载成功但没有场次的成员保留，交给 idle 列表。
  const available = datasets.filter(dataset => manifests.has(dataset.id));
  for (const dataset of available) {
    const manifest = manifests.get(dataset.id);
    if (!manifest) continue;
    for (const row of manifest.streams) {
      streams.push(toGroupStream(dataset.id, row));
    }
  }

  return buildGroupDataFromStreams(available, streams, now);
}

/** 完整 manifest 行 → 组视图行。生成脚本也复用同一份投影规则。 */
export function toGroupStream(datasetId: string, row: StreamSummary): GroupStreamSummary {
  return {
    datasetId,
    date: row.date,
    videoId: row.videoId,
    title: row.title,
    startedAt: row.startedAt,
    durationSec: row.durationSec,
    availability: row.availability,
    avgConcurrent: row.avgConcurrent,
    maxConcurrent: row.maxConcurrent,
    chatTotal: row.chatTotal,
    superchats: row.superchats,
    vstatsViews: row.vstatsViews,
    snapshotViews: row.snapshotViews,
    thumbnail: row.thumbnail,
  };
}

/** 最近有播的成员排在前面；没播过的按原始顺序垫底。 */
export function sortMembersByLatest(members: GroupMemberSummary[]): GroupMemberSummary[] {
  return [...members].sort((a, b) => {
    const left = a.latest?.startedAt ?? "";
    const right = b.latest?.startedAt ?? "";
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return right.localeCompare(left);
  });
}
