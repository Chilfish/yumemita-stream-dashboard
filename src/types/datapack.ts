/** `yumemita.stream-datapack/v1` 的 TypeScript 镜像。字段口径见 docs/data-model.md。 */

export interface CurrencyTotal {
  count: number;
  amount: number;
}

export type CurrencyTotals = Record<string, CurrencyTotal>;

export interface VideoSnapshot {
  views: number | null;
  likes: number | null;
  comments: number | null;
}

export interface VideoInfo {
  id: string;
  url: string;
  title: string | null;
  channelId: string | null;
  channelName: string | null;
  channelUrl: string | null;
  channelFollowersAtCapture: number | null;
  liveStatus: string | null;
  availability: string | null;
  startedAt: string | null;
  publishedAt: string | null;
  durationSec: number | null;
  durationHms: string | null;
  endedAt: string | null;
  thumbnail: string | null;
  description: string | null;
  links: string[];
  chapters: { title?: string; start_time?: number }[];
  hasLiveChatReplay: boolean;
  captionsJa: boolean;
  snapshot: VideoSnapshot;
}

export interface VstatsInfo {
  updatedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationText: string | null;
  maxConcurrent: number | null;
  maxConcurrentAt: string | null;
  avgConcurrent: number | null;
  watchTimeHours: number | null;
  views: number | null;
  likes: number | null;
}

export interface ChatByKind {
  text: number;
  superchat: number;
  sticker: number;
  membership: number;
}

export interface TimeRange {
  firstAt: string | null;
  lastAt: string | null;
  preRollSec: number | null;
}

export interface PeakMinute {
  offsetMin: number;
  at: string | null;
  count: number;
}

export interface TenMinuteBucket {
  offsetMin: number;
  at: string | null;
  messages: number;
  superchats: number;
}

export interface ChatDensity {
  perMinuteMean: number | null;
  peakMinute: PeakMinute | null;
  perMinute: number[];
  perMinuteSc: number[];
  perFiveMinute: number[];
  perTenMinute: TenMinuteBucket[];
}

export interface Superchat {
  at: string;
  author: string;
  amountText: string;
  currency: string;
  amount: number;
  message: string;
}

export interface Sticker {
  at: string;
  author: string;
  amountText: string;
  currency: string;
  amount: number;
}

export interface Membership {
  at: string;
  author: string;
  header: string | null;
}

export interface PaidInfo {
  superchats: Superchat[];
  scTotalsByCurrency: CurrencyTotals;
  stickers: Sticker[];
  stickerTotalsByCurrency: CurrencyTotals;
  memberships: Membership[];
  paidSharePct: number | null;
}

export interface TopAuthor {
  author: string;
  messages: number;
  superchats: number;
  stickers: number;
  memberships: number;
  badges: string[];
}

export interface TopWord {
  word: string;
  count: number;
}

export interface EmojiCount {
  id: string;
  count: number;
}

export interface EmojiKinds {
  distinct: number;
  top: EmojiCount[];
}

export interface ChatInfo {
  total: number;
  byKind: ChatByKind;
  pureEmojiOnly: number;
  uniqueAuthors: number;
  ownerMessages: number;
  badges: Record<string, number>;
  timeRange: TimeRange;
  coveragePct: number | null;
  density: ChatDensity;
  paid: PaidInfo;
  topAuthors: TopAuthor[];
  topWords: TopWord[];
  hashtags: Record<string, number>;
  emojiKinds: EmojiKinds;
}

export interface CommentItem {
  author: string | null;
  authorId: string | null;
  likes: number;
  at: string | null;
  pinned: boolean;
  byUploader: boolean;
  text: string;
}

export interface CommentsInfo {
  total: number;
  topLevel: number;
  replies: number;
  pinned: number;
  totalLikes: number;
  items: CommentItem[];
}

export interface DerivedInfo {
  chatPer1000AvgViewers: number | null;
  likesPer1000Views: number | null;
  scPerHour: number | null;
  vstatsVsYtdlpViews: number | null;
}

export interface StreamDatapack {
  schema: "yumemita.stream-datapack/v1";
  generatedAt: string;
  video: VideoInfo;
  vstats: VstatsInfo | null;
  chat: ChatInfo;
  comments: CommentsInfo | null;
  derived: DerivedInfo;
}
