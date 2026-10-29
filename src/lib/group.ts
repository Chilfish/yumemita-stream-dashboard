import type { DatasetIndexEntry, BatchManifest, StreamSummary } from "@/types/dataset";

export const DEFAULT_MEMBER_COLOR = "#b8461f";

/** 跨成员的一行：`StreamSummary` 加上它属于谁，页面据此拼链接、取封面、上成员色。 */
export interface GroupStreamRow extends StreamSummary {
  datasetId: string;
  memberLabel: string;
  memberColor: string;
}

export interface GroupMemberSummary {
  dataset: DatasetIndexEntry;
  latest: StreamSummary | null;
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

function streamDateKey(row: StreamSummary): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : null;
}

function summarizeMember(
  dataset: DatasetIndexEntry,
  rows: StreamSummary[],
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

  for (const row of rows) {
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
    latest: rows[0] ?? null,
    streamCount: rows.length,
    chatTotal,
    superchats,
    durationSec,
    weekStreams,
    weekChat,
    monthStreams,
    avgConcurrent: concurrentDuration > 0 ? weightedConcurrent / concurrentDuration : null,
  };
}

/**
 * 把各成员的 manifest 合成一份组级视图。
 * 只读 summary，不碰 datapack：组首页与全组相册都只需要场次级字段。
 */
export function buildGroupData(
  datasets: DatasetIndexEntry[],
  manifests: Map<string, BatchManifest>,
  now: Date = new Date(),
): GroupData {
  const weekStart = weekStartKey(now);
  const monthKey = jstDateKey(now).slice(0, 7);

  const rows: GroupStreamRow[] = [];
  const members: GroupMemberSummary[] = [];

  for (const dataset of datasets) {
    const manifest = manifests.get(dataset.id);
    if (!manifest) continue;

    const memberRows = [...manifest.streams].sort((a, b) =>
      (b.startedAt ?? "").localeCompare(a.startedAt ?? ""),
    );
    rows.push(
      ...memberRows.map(row => ({
        ...row,
        datasetId: dataset.id,
        memberLabel: dataset.label,
        memberColor: dataset.color ?? DEFAULT_MEMBER_COLOR,
      })),
    );
    members.push(summarizeMember(dataset, memberRows, weekStart, monthKey));
  }

  rows.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));

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

  return { members, rows, totals };
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
