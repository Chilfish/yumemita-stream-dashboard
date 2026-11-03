/** `yumemita.stream-datapack/v1` / `/v2` 的 TypeScript 镜像。字段口径见 docs/data/data-model.md。 */

/** datapack 的加载状态；现在由页面传入，作为视图的 props 类型。 */
export type PackStatus = 'idle' | 'loading' | 'ready' | 'error'

/** v2 起新增全量聚合字段；v1 datapack 只有截断后的 Top 列表。 */
export type DatapackSchema =
  | "yumemita.stream-datapack/v1"
  | "yumemita.stream-datapack/v2";

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
  /** 会员里程碑；领到的赠礼会员也计在这里。 */
  membership: number;
  /** 赠出会员（购买方的赠送公告）。旧 pack 没有这个字段。 */
  gift?: number;
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
  /** 留言里的表情 id（按出现顺序）；Unicode 表情是字符本身。 */
  emojis?: string[];
}

/** 频道专属表情；`id` 形如 `<channelId>/<hash>`。 */
export interface EmojiAsset {
  id: string;
  name: string | null;
  /** InnerTube 的原始图片地址，只给抓取脚本用；页面读对象存储。 */
  url: string;
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
  /** 自己入会/续费取原始回放的 `headerSubtext`；领到赠礼时为 `received a gift membership by …`。 */
  header: string | null;
}

/** 一次赠送会员公告（`Sent 50 … gift memberships`）。 */
export interface GiftMembership {
  at: string;
  /** 赠送方。 */
  author: string;
  /** 这次送出的会员个数。 */
  count: number;
  /** 公告原文。 */
  text: string;
}

export interface PaidInfo {
  superchats: Superchat[];
  scTotalsByCurrency: CurrencyTotals;
  stickers: Sticker[];
  stickerTotalsByCurrency: CurrencyTotals;
  memberships: Membership[];
  /** 赠送会员公告。旧 pack 没有这个字段。 */
  gifts?: GiftMembership[];
  paidSharePct: number | null;
}

export interface TopAuthor {
  author: string;
  /** v2 起带稳定的频道 ID；旧 pack 或原始回放缺失时为 null / undefined。 */
  authorId?: string | null;
  messages: number;
  superchats: number;
  stickers: number;
  memberships: number;
  badges: string[];
}

/** v2 的全量作者统计：不截断，用于精确跨场聚合与观众重叠。 */
export interface AuthorStat {
  author: string;
  authorId: string | null;
  messages: number;
  superchats: number;
  stickers: number;
  memberships: number;
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

/** 主播本人（徽章 `Owner`）的一条发言；按时间顺序存全量。 */
export interface OwnerChat {
  at: string;
  kind: "text" | "superchat" | "sticker" | "membership" | "gift";
  text: string;
  /** 留言里的表情 id（按出现顺序）；纯 Unicode 表情不会出现在这里。 */
  emojis?: string[];
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
  /** v2：全量作者统计（按发言数降序），不截断；v1 缺失。 */
  authors?: AuthorStat[];
  /** v2：全量分词词频，不截断；v1 缺失。 */
  wordCounts?: Record<string, number>;
  hashtags: Record<string, number>;
  emojiKinds: EmojiKinds;
  /** 本场出现过的频道专属表情；旧 pack 或没有原始回放时缺失。 */
  emojis?: EmojiAsset[];
  /** 主播本人发言明细（全量，按时间顺序）；旧 pack 没有这个字段。 */
  ownerChats?: OwnerChat[];
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
  schema: DatapackSchema;
  generatedAt: string;
  video: VideoInfo;
  vstats: VstatsInfo | null;
  chat: ChatInfo;
  comments: CommentsInfo | null;
  derived: DerivedInfo;
}
