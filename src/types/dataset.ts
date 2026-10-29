import type { ChatByKind, CurrencyTotals } from "./datapack";

/** `batch30_manifest.json` 的一行。字段由 collect-batch.mjs 产出。 */
export interface StreamSummary {
  rank: number;
  date: string;
  videoId: string;
  title: string;
  url: string;
  durationHms: string | null;
  durationSec: number | null;
  startedAt: string | null;
  endedAt: string | null;
  availability: string | null;
  avgConcurrent: number | null;
  maxConcurrent: number | null;
  maxConcurrentAt: string | null;
  watchTimeHours: number | null;
  vstatsViews: number | null;
  vstatsLikes: number | null;
  snapshotViews: number | null;
  snapshotLikes: number | null;
  snapshotComments: number | null;
  chatTotal: number;
  chatByKind: ChatByKind;
  pureEmojiOnly: number;
  uniqueAuthors: number;
  superchats: number;
  scTotalsByCurrency: CurrencyTotals;
  stickers: number;
  memberships: number;
  commentsCaptured: number | null;
  chatPer1000AvgViewers: number | null;
  likesPer1000Views: number | null;
  scPerHour: number | null;
  /** 封面原图的相对 key（`thumbs/<videoId>.jpg`）；WebP 变体由 videoId + 宽度推导。没有封面时为 null。 */
  thumbnail?: string | null;
  sessionDir: string;
  datapack: string;
  generatedAt: string;
}

export interface BatchManifest {
  schema: string;
  generatedAt: string;
  subject: string;
  channelId: string | null;
  scope: string;
  count: number;
  note: string;
  streams: StreamSummary[];
}

export interface DatasetIndexEntry {
  id: string;
  label: string;
  color?: string | null;
  avatar?: string | null;
  channelId: string | null;
  count: number;
  generatedAt: string | null;
  manifest: string;
  insights?: string;
}

export interface DatasetIndex {
  schema: string;
  generatedAt: string;
  datasets: DatasetIndexEntry[];
}
