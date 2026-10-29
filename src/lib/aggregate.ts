import {
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  classifyTitle,
  type ContentTypeKey,
} from "@/lib/classify";
import type {
  ChatByKind,
  CurrencyTotal,
  CurrencyTotals,
  EmojiCount,
  StreamDatapack,
  TopAuthor,
  TopWord,
} from "@/types/datapack";
import type { StreamSummary } from "@/types/dataset";

export interface StreamRow {
  summary: StreamSummary;
  pack: StreamDatapack;
}

export interface AggregatedWord extends TopWord {
  streams: number;
}

export interface AggregatedAuthor extends TopAuthor {
  streams: number;
}

export interface CurrencyRow extends CurrencyTotal {
  currency: string;
}

export interface StreamExtreme {
  videoId: string;
  title: string;
  value: number;
}

export interface PeakChatMinute extends StreamExtreme {
  offsetMin: number;
  at: string | null;
}

/** 典型节奏曲线的分桶数；每桶代表 1/20 的直播进度。 */
export const STREAM_SHAPE_BUCKETS = 20;

export interface StreamShapeBucket {
  /** 桶中心的相对进度（0–1）。 */
  position: number;
  /** 平均相对活跃度：1 = 该场自身的每分钟弹幕均值。 */
  relative: number;
  /** 平均每分钟弹幕条数。 */
  perMinute: number;
  /** 相对活跃度的 25 分位。 */
  p25: number;
  /** 相对活跃度的 75 分位。 */
  p75: number;
  /** 参与该桶的场次数。 */
  streams: number;
}

export interface StreamShape {
  bucketCount: number;
  streams: number;
  buckets: StreamShapeBucket[];
  headRelative: number | null;
  midRelative: number | null;
  tailRelative: number | null;
  peak: { position: number; relative: number } | null;
}

export interface DatasetTotals {
  streamCount: number;
  memberOnlyCount: number;
  withVstatsCount: number;
  durationSec: number;
  chatTotal: number;
  chatByKind: ChatByKind;
  pureEmojiOnly: number;
  uniqueAuthorsSum: number;
  commentTotal: number;
  commentLikes: number;
  views: number;
  likes: number;
  watchHours: number;
  weightedAvgConcurrent: number | null;
  avgChatPerMinute: number | null;
  paidSharePct: number | null;
  scByCurrency: CurrencyRow[];
  stickerByCurrency: CurrencyRow[];
  topWords: AggregatedWord[];
  topAuthors: AggregatedAuthor[];
  badges: { name: string; count: number }[];
  emoji: EmojiCount[];
  hashtags: { tag: string; count: number }[];
  bestByAvg: StreamExtreme | null;
  bestByChat: StreamExtreme | null;
  bestBySc: StreamExtreme | null;
  peakChatMinute: PeakChatMinute | null;
  streamShape: StreamShape | null;
}

export function buildSummaryRows(manifest: { streams: StreamSummary[] }): StreamSummary[] {
  return [...manifest.streams].sort((a, b) =>
    (b.startedAt ?? "").localeCompare(a.startedAt ?? ""),
  );
}

export function buildStreamRows(
  manifest: { streams: StreamSummary[] },
  packs: Map<string, StreamDatapack>,
): StreamRow[] {
  return manifest.streams
    .map(summary => {
      const pack = packs.get(summary.videoId);
      return pack ? { summary, pack } : null;
    })
    .filter((row): row is StreamRow => row !== null)
    .sort((a, b) => (b.summary.startedAt ?? "").localeCompare(a.summary.startedAt ?? ""));
}

export function currencyRows(totals: CurrencyTotals): CurrencyRow[] {
  return Object.entries(totals)
    .map(([currency, total]) => ({ currency, ...total }))
    .sort((a, b) => b.amount - a.amount);
}

function addCurrency(target: Map<string, CurrencyTotal>, source: CurrencyTotals): void {
  for (const [currency, total] of Object.entries(source)) {
    const current = target.get(currency) ?? { count: 0, amount: 0 };
    current.count += total.count;
    current.amount += total.amount;
    target.set(currency, current);
  }
}

function emptyKind(): ChatByKind {
  return { text: 0, superchat: 0, sticker: 0, membership: 0 };
}

function maxBy<T>(items: T[], value: (item: T) => number | null | undefined): T | null {
  let best: T | null = null;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const current = value(item);
    if (current == null || !Number.isFinite(current)) continue;
    if (current > bestValue) {
      best = item;
      bestValue = current;
    }
  }
  return best;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower] ?? 0;
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? low;
  return low + (high - low) * (position - lower);
}

/**
 * 把每场直播的逐分钟弹幕曲线按「直播进度」对齐，得到典型节奏。
 *
 * 各场时长和绝对热度差异很大，因此先按场次自身均值归一化（1 = 该场平均每分钟弹幕），
 * 再等权平均；这样长场和高热度场不会压过其余场次。分桶内取该桶每分钟速率，
 * 避免长度不整除导致某个桶被少算。
 */
export function buildStreamShape(
  rows: Pick<StreamRow, "pack">[],
  bucketCount = STREAM_SHAPE_BUCKETS,
): StreamShape | null {
  const buckets = Math.max(4, Math.floor(bucketCount));
  const relativeBuckets: number[][] = Array.from({ length: buckets }, () => []);
  const rateBuckets: number[][] = Array.from({ length: buckets }, () => []);
  let streams = 0;

  for (const { pack } of rows) {
    const minutes = pack.chat.density?.perMinute ?? [];
    if (minutes.length < buckets) continue;
    const mean = average(minutes);
    if (!(mean > 0)) continue;

    const sums = new Array<number>(buckets).fill(0);
    const counts = new Array<number>(buckets).fill(0);
    for (let index = 0; index < minutes.length; index += 1) {
      const bucket = Math.min(buckets - 1, Math.floor((index * buckets) / minutes.length));
      sums[bucket] = (sums[bucket] ?? 0) + (minutes[index] ?? 0);
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }

    for (let bucket = 0; bucket < buckets; bucket += 1) {
      const count = counts[bucket] ?? 0;
      if (count === 0) continue;
      const rate = (sums[bucket] ?? 0) / count;
      relativeBuckets[bucket]?.push(rate / mean);
      rateBuckets[bucket]?.push(rate);
    }
    streams += 1;
  }

  if (streams === 0) return null;

  const shapeBuckets: StreamShapeBucket[] = relativeBuckets.map((values, bucket) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      position: (bucket + 0.5) / buckets,
      relative: average(values),
      perMinute: average(rateBuckets[bucket] ?? []),
      p25: quantile(sorted, 0.25),
      p75: quantile(sorted, 0.75),
      streams: values.length,
    };
  });

  const head = shapeBuckets[0] ?? null;
  const mid = shapeBuckets[Math.floor(shapeBuckets.length / 2)] ?? null;
  const tail = shapeBuckets.at(-1) ?? null;
  const peakBucket = maxBy(shapeBuckets, item => item.relative);

  return {
    bucketCount: buckets,
    streams,
    buckets: shapeBuckets,
    headRelative: head?.relative ?? null,
    midRelative: mid?.relative ?? null,
    tailRelative: tail?.relative ?? null,
    peak: peakBucket ? { position: peakBucket.position, relative: peakBucket.relative } : null,
  };
}

export function aggregateDataset(rows: StreamRow[]): DatasetTotals {
  const chatByKind = emptyKind();
  const scTotals = new Map<string, CurrencyTotal>();
  const stickerTotals = new Map<string, CurrencyTotal>();
  const wordCounts = new Map<string, AggregatedWord>();
  const authorCounts = new Map<string, AggregatedAuthor>();
  const badgeCounts = new Map<string, number>();
  const emojiCounts = new Map<string, number>();
  const hashtagCounts = new Map<string, number>();

  let durationSec = 0;
  let chatTotal = 0;
  let pureEmojiOnly = 0;
  let uniqueAuthorsSum = 0;
  let commentTotal = 0;
  let commentLikes = 0;
  let views = 0;
  let likes = 0;
  let watchHours = 0;
  let paidShareSum = 0;
  let paidShareCount = 0;
  let weightedAvgNumerator = 0;
  let weightedAvgDenominator = 0;
  let memberOnlyCount = 0;
  let withVstatsCount = 0;
  let bestPeak: PeakChatMinute | null = null;
  const packRows: { row: StreamRow; chat: number; sc: number; avg: number | null }[] = [];

  for (const row of rows) {
    const { summary, pack } = row;
    const chat = pack.chat;
    durationSec += summary.durationSec ?? 0;
    chatTotal += chat.total;
    chatByKind.text += chat.byKind.text;
    chatByKind.superchat += chat.byKind.superchat;
    chatByKind.sticker += chat.byKind.sticker;
    chatByKind.membership += chat.byKind.membership;
    pureEmojiOnly += chat.pureEmojiOnly;
    uniqueAuthorsSum += chat.uniqueAuthors;
    commentTotal += pack.comments?.total ?? 0;
    commentLikes += pack.comments?.totalLikes ?? 0;
    views += pack.vstats?.views ?? pack.video.snapshot.views ?? 0;
    likes += pack.vstats?.likes ?? pack.video.snapshot.likes ?? 0;
    watchHours += pack.vstats?.watchTimeHours ?? 0;
    if (chat.paid.paidSharePct != null) {
      paidShareSum += chat.paid.paidSharePct;
      paidShareCount += 1;
    }
    if (pack.video.availability === "subscriber_only") memberOnlyCount += 1;
    if (pack.vstats?.avgConcurrent != null) {
      withVstatsCount += 1;
      if (summary.durationSec) {
        weightedAvgNumerator += pack.vstats.avgConcurrent * summary.durationSec;
        weightedAvgDenominator += summary.durationSec;
      }
    }

    addCurrency(scTotals, chat.paid.scTotalsByCurrency);
    addCurrency(stickerTotals, chat.paid.stickerTotalsByCurrency);

    for (const word of chat.topWords) {
      const current = wordCounts.get(word.word) ?? { word: word.word, count: 0, streams: 0 };
      current.count += word.count;
      current.streams += 1;
      wordCounts.set(word.word, current);
    }
    for (const author of chat.topAuthors) {
      const current = authorCounts.get(author.author) ?? {
        author: author.author,
        messages: 0,
        superchats: 0,
        stickers: 0,
        memberships: 0,
        badges: author.badges,
        streams: 0,
      };
      current.messages += author.messages;
      current.superchats += author.superchats;
      current.stickers += author.stickers;
      current.memberships += author.memberships;
      current.streams += 1;
      authorCounts.set(author.author, current);
    }
    for (const [badge, count] of Object.entries(chat.badges)) {
      badgeCounts.set(badge, (badgeCounts.get(badge) ?? 0) + count);
    }
    for (const emoji of chat.emojiKinds.top) {
      emojiCounts.set(emoji.id, (emojiCounts.get(emoji.id) ?? 0) + emoji.count);
    }
    for (const [tag, count] of Object.entries(chat.hashtags)) {
      hashtagCounts.set(tag, (hashtagCounts.get(tag) ?? 0) + count);
    }

    const minutes = chat.density.perMinute;
    for (let index = 0; index < minutes.length; index += 1) {
      const count = minutes[index] ?? 0;
      if (count > (bestPeak?.value ?? 0)) {
        const at = summary.startedAt
          ? new Date(Date.parse(summary.startedAt) + index * 60_000).toISOString()
          : null;
        bestPeak = {
          videoId: summary.videoId,
          title: summary.title,
          value: count,
          offsetMin: index,
          at,
        };
      }
    }

    packRows.push({
      row,
      chat: chat.total,
      sc: chat.paid.superchats.length,
      avg: pack.vstats?.avgConcurrent ?? null,
    });
  }

  const bestByAvgRow = maxBy(packRows, item => item.avg);
  const bestByChatRow = maxBy(packRows, item => item.chat);
  const bestByScRow = maxBy(packRows, item => item.sc);

  return {
    streamCount: rows.length,
    memberOnlyCount,
    withVstatsCount,
    durationSec,
    chatTotal,
    chatByKind,
    pureEmojiOnly,
    uniqueAuthorsSum,
    commentTotal,
    commentLikes,
    views,
    likes,
    watchHours,
    weightedAvgConcurrent: weightedAvgDenominator > 0
      ? weightedAvgNumerator / weightedAvgDenominator
      : null,
    avgChatPerMinute: durationSec > 0 ? chatTotal / (durationSec / 60) : null,
    paidSharePct: paidShareCount > 0 ? paidShareSum / paidShareCount : null,
    scByCurrency: currencyRows(Object.fromEntries(scTotals)),
    stickerByCurrency: currencyRows(Object.fromEntries(stickerTotals)),
    topWords: [...wordCounts.values()].sort((a, b) => b.count - a.count).slice(0, 40),
    topAuthors: [...authorCounts.values()].sort((a, b) => b.messages - a.messages).slice(0, 30),
    badges: [...badgeCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    emoji: [...emojiCounts.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    hashtags: [...hashtagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count),
    bestByAvg: bestByAvgRow
      ? { videoId: bestByAvgRow.row.summary.videoId, title: bestByAvgRow.row.summary.title, value: bestByAvgRow.avg ?? 0 }
      : null,
    bestByChat: bestByChatRow
      ? { videoId: bestByChatRow.row.summary.videoId, title: bestByChatRow.row.summary.title, value: bestByChatRow.chat }
      : null,
    bestBySc: bestByScRow
      ? { videoId: bestByScRow.row.summary.videoId, title: bestByScRow.row.summary.title, value: bestByScRow.sc }
      : null,
    peakChatMinute: bestPeak,
    streamShape: buildStreamShape(rows),
  };
}

export function findStreamSummary(
  rows: StreamSummary[],
  videoId: string | null,
): StreamSummary | null {
  if (!videoId) return null;
  return rows.find(row => row.videoId === videoId) ?? null;
}

export function findStreamRow(rows: StreamRow[], videoId: string | null): StreamRow | null {
  if (!videoId) return null;
  return rows.find(row => row.summary.videoId === videoId) ?? null;
}

export interface MonthlyPoint {
  /** `YYYY-MM` */
  month: string;
  /** 展示用，例如 `10 月` */
  label: string;
  streams: number;
  durationSec: number;
  chatTotal: number;
  superchats: number;
  chatPerMinute: number | null;
  avgAuthors: number | null;
  avgConcurrent: number | null;
}

/** 按自然月聚合；返回按时间正序排列的最近 `limit` 个月。 */
export function buildMonthlySeries(rows: StreamSummary[], limit = 6): MonthlyPoint[] {
  const buckets = new Map<
    string,
    {
      streams: number;
      durationSec: number;
      chatTotal: number;
      superchats: number;
      authors: number;
      authorsCount: number;
      concurrentSum: number;
      concurrentCount: number;
    }
  >();

  for (const row of rows) {
    if (!row.startedAt) continue;
    const month = row.startedAt.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const bucket = buckets.get(month) ?? {
      streams: 0,
      durationSec: 0,
      chatTotal: 0,
      superchats: 0,
      authors: 0,
      authorsCount: 0,
      concurrentSum: 0,
      concurrentCount: 0,
    };
    bucket.streams += 1;
    bucket.durationSec += row.durationSec ?? 0;
    bucket.chatTotal += row.chatTotal ?? 0;
    bucket.superchats += row.superchats ?? 0;
    if (row.uniqueAuthors > 0) {
      bucket.authors += row.uniqueAuthors;
      bucket.authorsCount += 1;
    }
    if (row.avgConcurrent != null) {
      bucket.concurrentSum += row.avgConcurrent;
      bucket.concurrentCount += 1;
    }
    buckets.set(month, bucket);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-Math.max(1, limit))
    .map(([month, bucket]) => ({
      month,
      label: `${Number(month.slice(5, 7))} 月`,
      streams: bucket.streams,
      durationSec: bucket.durationSec,
      chatTotal: bucket.chatTotal,
      superchats: bucket.superchats,
      chatPerMinute:
        bucket.durationSec > 0 ? bucket.chatTotal / (bucket.durationSec / 60) : null,
      avgAuthors: bucket.authorsCount > 0 ? bucket.authors / bucket.authorsCount : null,
      avgConcurrent:
        bucket.concurrentCount > 0 ? bucket.concurrentSum / bucket.concurrentCount : null,
    }));
}

export type CalendarMetric = "streams" | "chat" | "superchats";

export interface CalendarDay {
  /** JST 自然日，`YYYY-MM-DD`。 */
  date: string;
  streams: number;
  chat: number;
  superchats: number;
  durationSec: number;
}

/** 按 JST 自然日聚合场次；同一天多场会合并。 */
export function buildCalendarDays(rows: StreamSummary[]): CalendarDay[] {
  const byDate = new Map<string, CalendarDay>();

  for (const row of rows) {
    const candidate = /^\d{4}-\d{2}-\d{2}$/.test(row.date)
      ? row.date
      : (row.startedAt?.slice(0, 10) ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) continue;

    const day = byDate.get(candidate) ?? {
      date: candidate,
      streams: 0,
      chat: 0,
      superchats: 0,
      durationSec: 0,
    };
    day.streams += 1;
    day.chat += row.chatTotal ?? 0;
    day.superchats += row.superchats ?? 0;
    day.durationSec += row.durationSec ?? 0;
    byDate.set(candidate, day);
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function calendarMetricValue(day: CalendarDay, metric: CalendarMetric): number {
  switch (metric) {
    case "streams":
      return day.streams;
    case "chat":
      return day.chat;
    case "superchats":
      return day.superchats;
  }
}

export interface ContentTypeStat {
  key: ContentTypeKey;
  label: string;
  streams: number;
  share: number;
  durationSec: number;
  avgDurationSec: number | null;
  chatTotal: number;
  superchats: number;
  commentsCaptured: number;
  commentsPerStream: number | null;
  chatPerMinute: number | null;
  scPerHour: number | null;
  avgConcurrent: number | null;
  concurrentStreams: number;
}

/** 按标题类型聚合；未命中规则的行归入「杂谈」，与 `classifyTitles` 口径一致。 */
export function buildContentTypeStats(rows: StreamSummary[]): ContentTypeStat[] {
  const buckets = new Map<
    ContentTypeKey,
    {
      streams: number;
      durationSec: number;
      chatTotal: number;
      superchats: number;
      commentsCaptured: number;
      concurrentSum: number;
      concurrentStreams: number;
    }
  >(
    CONTENT_TYPES.map(key => [
      key,
      {
        streams: 0,
        durationSec: 0,
        chatTotal: 0,
        superchats: 0,
        commentsCaptured: 0,
        concurrentSum: 0,
        concurrentStreams: 0,
      },
    ]),
  );

  for (const row of rows) {
    const { key } = classifyTitle(row.title);
    const bucket = buckets.get(key);
    if (!bucket) continue;

    bucket.streams += 1;
    bucket.durationSec += row.durationSec ?? 0;
    bucket.chatTotal += row.chatTotal ?? 0;
    bucket.superchats += row.superchats ?? 0;
    bucket.commentsCaptured += row.commentsCaptured ?? 0;
    if (row.avgConcurrent != null) {
      bucket.concurrentSum += row.avgConcurrent;
      bucket.concurrentStreams += 1;
    }
  }

  return CONTENT_TYPES.map(key => {
    const bucket = buckets.get(key) ?? {
      streams: 0,
      durationSec: 0,
      chatTotal: 0,
      superchats: 0,
      commentsCaptured: 0,
      concurrentSum: 0,
      concurrentStreams: 0,
    };
    return {
      key,
      label: CONTENT_TYPE_LABELS[key],
      streams: bucket.streams,
      share: rows.length > 0 ? bucket.streams / rows.length : 0,
      durationSec: bucket.durationSec,
      avgDurationSec: bucket.streams > 0 ? bucket.durationSec / bucket.streams : null,
      chatTotal: bucket.chatTotal,
      superchats: bucket.superchats,
      commentsCaptured: bucket.commentsCaptured,
      commentsPerStream:
        bucket.streams > 0 ? bucket.commentsCaptured / bucket.streams : null,
      chatPerMinute:
        bucket.durationSec > 0 ? bucket.chatTotal / (bucket.durationSec / 60) : null,
      scPerHour:
        bucket.durationSec > 0 ? bucket.superchats / (bucket.durationSec / 3600) : null,
      avgConcurrent:
        bucket.concurrentStreams > 0 ? bucket.concurrentSum / bucket.concurrentStreams : null,
      concurrentStreams: bucket.concurrentStreams,
    };
  });
}

/** 环比变化（%）；任一值为空或分母为 0 时返回 null。 */
export function percentChange(
  current: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

