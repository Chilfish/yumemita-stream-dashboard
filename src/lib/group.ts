import type { BatchManifest, DatasetIndexEntry, StreamSummary } from "@/types/dataset";
import { isMemberOnly } from "@/lib/visibility";
import type {
  GroupDayStat,
  GroupDayTotal,
  GroupMemberStat,
  GroupStreamSummary,
  GroupSummaryFile,
  GroupTotalsStat,
} from "@/types/group";

export const DEFAULT_MEMBER_COLOR = "#b8461f";

/** 组首页出勤条的窗口长度；与查询层 `DAY_WINDOW` 共用同一常量。 */
export const ATTENDANCE_WINDOW_DAYS = 100;

/** 跨成员的一行：精简场次字段 + 它属于谁，页面据此拼链接、取封面、上成员色。 */
export interface GroupStreamRow extends GroupStreamSummary {
  memberLabel: string;
  memberColor: string;
  /** 频道主；联动场被展示在某位参与者名下时与 `datasetId` 不同。 */
  ownerDatasetId: string;
  /** 频道主之外的参与成员标签，顺序与 `participants` 一致。 */
  participantLabels: string[];
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
  /**
   * 组首页出勤条用的近 100 天日桶，已限定在 `attendanceStart`–`attendanceEnd` 内。
   * 相册路径没有这份精简数据，返回空数组。
   */
  days: GroupDayStat[];
  /** 出勤窗口的日期由服务端确定，避免客户端换日时重新计算导致水合差异。 */
  attendanceStart: string | null;
  attendanceEnd: string | null;
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

/** 出勤窗口：以 JST 今天为终点，向前共 `ATTENDANCE_WINDOW_DAYS` 天。 */
export function attendanceWindow(now: Date = new Date()): { start: string; end: string } {
  const end = jstDateKey(now);
  return { start: shiftDateKey(end, -(ATTENDANCE_WINDOW_DAYS - 1)), end };
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
  memberOnly: boolean;
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
    const date = streamDateKey(row);
    if (date && date >= weekStart) weekStreams += 1;
    if (date && date.slice(0, 7) === monthKey) monthStreams += 1;

    // 场次 / 日期统计保留会限；弹幕、SC、时长与同接只累加公开场次。
    if (row.memberOnly) continue;

    chatTotal += row.chatTotal ?? 0;
    superchats += row.superchats ?? 0;
    durationSec += row.durationSec ?? 0;
    if (date && date >= weekStart) weekChat += row.chatTotal ?? 0;

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

/**
 * 全组合计。按去重后的场次行算，不累加成员汇总：
 * 联动场同时属于两位成员，累加会把全组场次数与弹幕算两遍。
 */
function totalsOf(
  rows: GroupStreamSummary[],
  weekStart: string,
  monthKey: string,
): GroupTotals {
  const totals: GroupTotals = {
    streamCount: 0,
    chatTotal: 0,
    superchats: 0,
    durationSec: 0,
    weekStreams: 0,
    weekChat: 0,
    monthStreams: 0,
  };
  const seen = new Set<string>();

  for (const row of rows) {
    // 同一个 videoId 只计一次；rows 已经是按 owner 唯一的列表，这里再做一层保护。
    if (seen.has(row.videoId)) continue;
    seen.add(row.videoId);

    const memberOnly = isMemberOnly(row.availability);
    const date = streamDateKey(row);
    totals.streamCount += 1;
    if (date && date >= weekStart) totals.weekStreams += 1;
    if (date && date.slice(0, 7) === monthKey) totals.monthStreams += 1;
    if (memberOnly) continue;

    totals.chatTotal += row.chatTotal;
    totals.superchats += row.superchats;
    totals.durationSec += row.durationSec ?? 0;
    if (date && date >= weekStart) totals.weekChat += row.chatTotal;
  }

  return totals;
}

function sortRows<T extends { startedAt: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}

function attachMember(
  dataset: DatasetIndexEntry,
  row: GroupStreamSummary,
  datasetById: Map<string, DatasetIndexEntry>,
): GroupStreamRow {
  return {
    ...row,
    memberLabel: dataset.label,
    memberColor: dataset.color ?? DEFAULT_MEMBER_COLOR,
    ownerDatasetId: row.ownerDatasetId ?? row.datasetId,
    participantLabels: (row.participants ?? [])
      .filter(id => id !== row.datasetId)
      .map(id => datasetById.get(id)?.label ?? id),
  };
}

/**
 * 首页只加载 `group-summary.json`：members 是全期汇总，days 覆盖最近 100 天，
 * 用来按「现在」计算近 7 天 / 本月窗口与出勤条；latest/recent 负责渲染。
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
      latest: latestRow ? attachMember(dataset, latestRow, datasetById) : null,
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
      return dataset ? attachMember(dataset, row, datasetById) : null;
    })
    .filter((row): row is GroupStreamRow => row !== null);

  const { start: attendanceStart, end: attendanceEnd } = attendanceWindow(now);
  // 组级窗口按去重后的全组日桶算：成员桶里联动场会出现两次。
  const groupDays = summary.dayTotals ?? summary.days;
  let weekStreams = 0;
  let weekChat = 0;
  let monthStreams = 0;
  for (const day of groupDays) {
    if (day.date >= weekStart) {
      weekStreams += day.streams;
      weekChat += day.chat;
    }
    if (day.date.slice(0, 7) === monthKey) monthStreams += day.streams;
  }

  return {
    members,
    rows: sortRows(rows),
    totals: {
      streamCount: summary.totals.streamCount,
      chatTotal: summary.totals.chatTotal,
      superchats: summary.totals.superchats,
      durationSec: summary.totals.durationSec,
      weekStreams,
      weekChat,
      monthStreams,
    },
    days: summary.days.filter(day => day.date >= attendanceStart && day.date <= attendanceEnd),
    attendanceStart,
    attendanceEnd,
  };
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

  // rows 是全组唯一列表（每个 videoId 一条），成员统计另行按 owner ∪ 参与者展开。
  const byMember = new Map<string, GroupStreamSummary[]>();
  for (const stream of streams) {
    const memberIds = [stream.datasetId, ...(stream.participants ?? [])];
    for (const memberId of new Set(memberIds)) {
      const bucket = byMember.get(memberId);
      if (bucket) bucket.push(stream);
      else byMember.set(memberId, [stream]);
    }
  }

  const rows: GroupStreamRow[] = [];
  const members: GroupMemberSummary[] = [];

  for (const dataset of datasets) {
    // 没有场次的成员也要留在 members 里：组首页的 idle 列表靠它渲染。
    const source = byMember.get(dataset.id) ?? [];
    const memberRows = sortRows(source).map(row => attachMember(dataset, row, datasetById));
    const stats: RowStat[] = memberRows.map(row => ({
      date: row.date,
      chatTotal: row.chatTotal,
      superchats: row.superchats,
      durationSec: row.durationSec,
      avgConcurrent: row.avgConcurrent,
      memberOnly: isMemberOnly(row.availability),
    }));

    members.push(
      summarizeMember(
        dataset,
        stats,
        memberRows.find(row => !isMemberOnly(row.availability)) ?? null,
        weekStart,
        monthKey,
      ),
    );
  }

  // 全组列表按频道主归属铺一次，联动场不会因为参与者多出一行。
  for (const stream of streams) {
    const dataset = datasetById.get(stream.datasetId);
    if (dataset) rows.push(attachMember(dataset, stream, datasetById));
  }

  return {
    members,
    rows: sortRows(rows),
    totals: totalsOf(streams, weekStart, monthKey),
    days: [],
    attendanceStart: null,
    attendanceEnd: null,
  };
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
  const memberOnly = isMemberOnly(row.availability);
  return {
    datasetId,
    participants: row.participants ?? [],
    date: row.date,
    videoId: row.videoId,
    title: row.title,
    startedAt: row.startedAt,
    durationSec: row.durationSec,
    availability: row.availability,
    masked: memberOnly,
    avgConcurrent: memberOnly ? null : row.avgConcurrent,
    maxConcurrent: memberOnly ? null : row.maxConcurrent,
    chatTotal: memberOnly ? 0 : row.chatTotal,
    superchats: memberOnly ? 0 : row.superchats,
    vstatsViews: memberOnly ? null : row.vstatsViews,
    snapshotViews: memberOnly ? null : row.snapshotViews,
    thumbnail: row.thumbnail,
  };
}

/** 成员统计的字段子集：联动场也要并进来，但只并这一层。 */
export interface MemberStatLike {
  datasetId: string;
  streamCount: number;
  chatTotal: number;
  superchats: number;
  durationSec: number;
  avgConcurrent: number | null;
}

export interface DayStatLike {
  datasetId: string;
  date: string;
  streams: number;
  chat: number;
}

/**
 * 把联动场并进每位成员的汇总。
 * 参与场次对成员而言就是他的一场，指标原样累加；全组去重由调用方按 videoId 负责。
 */
export function mergeParticipantStats<T extends MemberStatLike>(
  stats: T[],
  participantStreams: GroupStreamSummary[],
): T[] {
  if (participantStreams.length === 0) return stats
  const byMember = new Map(stats.map(stat => [stat.datasetId, stat]))
  // 平均同接按「同接 × 时长」加权：先把已有的加权和还原出来，累加后再除。
  const weighted = new Map<string, { sum: number; duration: number }>()
  for (const stat of stats) {
    weighted.set(stat.datasetId, stat.avgConcurrent == null
      ? { sum: 0, duration: 0 }
      : { sum: stat.avgConcurrent * stat.durationSec, duration: stat.durationSec })
  }

  for (const stream of participantStreams) {
    if (isMemberOnly(stream.availability)) continue
    const durationSec = stream.durationSec ?? 0

    for (const participantId of stream.participants ?? []) {
      const current = byMember.get(participantId)
      if (!current) continue
      current.streamCount += 1
      current.chatTotal += stream.chatTotal
      current.superchats += stream.superchats
      current.durationSec += durationSec

      const bucket = weighted.get(participantId) ?? { sum: 0, duration: 0 }
      if (stream.avgConcurrent != null && durationSec > 0) {
        bucket.sum += stream.avgConcurrent * durationSec
        bucket.duration += durationSec
      }
      weighted.set(participantId, bucket)
    }
  }

  // 有同接的场次要计入场次数，但会员限定场不计派生指标。
  for (const stream of participantStreams) {
    if (!isMemberOnly(stream.availability)) continue
    for (const participantId of stream.participants ?? []) {
      const current = byMember.get(participantId)
      if (current) current.streamCount += 1
    }
  }

  for (const stat of stats) {
    const bucket = weighted.get(stat.datasetId)
    stat.avgConcurrent = bucket && bucket.duration > 0 ? bucket.sum / bucket.duration : null
  }

  return stats
}

/** 把联动场并进成员 × 日桶。 */
export function mergeParticipantDays<T extends DayStatLike>(
  days: T[],
  participantStreams: GroupStreamSummary[],
): T[] {
  if (participantStreams.length === 0) return days
  const byKey = new Map(days.map(day => [`${day.datasetId}|${day.date}`, day]))

  for (const stream of participantStreams) {
    const chat = isMemberOnly(stream.availability) ? 0 : stream.chatTotal
    for (const participantId of stream.participants ?? []) {
      const key = `${participantId}|${stream.date}`
      const current = byKey.get(key)
      if (current) {
        current.streams += 1
        current.chat += chat
        continue
      }
      const created = {
        datasetId: participantId,
        date: stream.date,
        streams: 1,
        chat,
      } as T
      byKey.set(key, created)
      days.push(created)
    }
  }

  return days
}

/** 每位成员的最新一场：owner 场次里挑一个，参与场次里挑更好的那个。 */
export function pickLatestStreams(
  latest: GroupStreamSummary[],
  participantStreams: GroupStreamSummary[],
): GroupStreamSummary[] {
  if (participantStreams.length === 0) return latest
  const byMember = new Map(latest.map(row => [row.datasetId, row]))

  for (const stream of participantStreams) {
    for (const participantId of stream.participants ?? []) {
      const current = byMember.get(participantId)
      const candidate: GroupStreamSummary = {
        ...stream,
        datasetId: participantId,
        ownerDatasetId: stream.datasetId,
      }
      if (!current || (candidate.startedAt ?? '') > (current.startedAt ?? '')) {
        byMember.set(participantId, candidate)
      }
    }
  }

  return [...byMember.values()]
}

/** 全组合计：成员汇总相加后再扣掉联动场重复计入的部分。 */
export function sumGroupTotals<T extends MemberStatLike>(
  members: T[],
  participantStreams: GroupStreamSummary[],
): GroupTotalsStat {
  const totals: GroupTotalsStat = { streamCount: 0, chatTotal: 0, superchats: 0, durationSec: 0 }
  for (const member of members) {
    totals.streamCount += member.streamCount
    totals.chatTotal += member.chatTotal
    totals.superchats += member.superchats
    totals.durationSec += member.durationSec
  }

  // 一场联动会被算进 N 位成员，全组只该计 1 次；这里补扣 N-1 份。
  for (const stream of participantStreams) {
    const extra = (stream.participants ?? []).length
    if (extra === 0) continue
    totals.streamCount -= extra
    if (isMemberOnly(stream.availability)) continue
    totals.chatTotal -= stream.chatTotal * extra
    totals.superchats -= stream.superchats * extra
    totals.durationSec -= (stream.durationSec ?? 0) * extra
  }

  return totals
}

/** 全组按日桶：成员桶相加后扣掉联动场的重复部分。 */
export function sumGroupDays(
  days: DayStatLike[],
  participantStreams: GroupStreamSummary[],
): GroupDayTotal[] {
  const byDate = new Map<string, GroupDayTotal>()
  for (const day of days) {
    const current = byDate.get(day.date) ?? { date: day.date, streams: 0, chat: 0 }
    current.streams += day.streams
    current.chat += day.chat
    byDate.set(day.date, current)
  }

  for (const stream of participantStreams) {
    const extra = (stream.participants ?? []).length
    if (extra === 0 || !isDateKey(stream.date)) continue
    const current = byDate.get(stream.date) ?? { date: stream.date, streams: 0, chat: 0 }
    current.streams -= extra
    if (!isMemberOnly(stream.availability)) current.chat -= stream.chatTotal * extra
    byDate.set(stream.date, current)
  }

  return [...byDate.values()]
    .filter(day => day.streams > 0 || day.chat > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
}

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
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
