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
