import * as v from "valibot";

const CurrencyTotalSchema = v.object({
  count: v.number(),
  amount: v.number(),
});

export const CurrencyTotalsSchema = v.record(v.string(), CurrencyTotalSchema);

export const ChatByKindSchema = v.object({
  text: v.number(),
  superchat: v.number(),
  sticker: v.number(),
  membership: v.number(),
});

export const DatasetIndexSchema = v.object({
  schema: v.string(),
  generatedAt: v.string(),
  datasets: v.pipe(v.array(v.object({
    id: v.string(),
    label: v.string(),
    color: v.optional(v.nullable(v.string())),
    avatar: v.optional(v.nullable(v.string())),
    count: v.number(),
    generatedAt: v.nullable(v.string()),
    manifest: v.string(),
    insights: v.optional(v.string()),
  })), v.minLength(1, "index.json 没有 datasets")),
});

export const StreamSummarySchema = v.object({
  videoId: v.string(),
  title: v.string(),
  url: v.string(),
  date: v.string(),
  startedAt: v.nullable(v.string()),
  durationSec: v.nullable(v.number()),
  chatTotal: v.number(),
  uniqueAuthors: v.number(),
  superchats: v.number(),
  chatByKind: ChatByKindSchema,
  scTotalsByCurrency: CurrencyTotalsSchema,
  availability: v.nullable(v.string()),
  avgConcurrent: v.nullable(v.number()),
  maxConcurrent: v.nullable(v.number()),
  watchTimeHours: v.nullable(v.number()),
  vstatsViews: v.nullable(v.number()),
  snapshotViews: v.nullable(v.number()),
  snapshotLikes: v.nullable(v.number()),
  snapshotComments: v.nullable(v.number()),
  commentsCaptured: v.nullable(v.number()),
  likesPer1000Views: v.nullable(v.number()),
  chatPer1000AvgViewers: v.nullable(v.number()),
  scPerHour: v.nullable(v.number()),
});

export const ManifestSchema = v.object({
  schema: v.string(),
  generatedAt: v.string(),
  scope: v.string(),
  count: v.number(),
  streams: v.array(StreamSummarySchema),
});

const VideoSnapshotSchema = v.object({
  views: v.nullable(v.number()),
  likes: v.nullable(v.number()),
  comments: v.nullable(v.number()),
});

const DatapackVideoSchema = v.object({
  id: v.string(),
  title: v.nullable(v.string()),
  url: v.string(),
  availability: v.nullable(v.string()),
  startedAt: v.nullable(v.string()),
  endedAt: v.nullable(v.string()),
  durationSec: v.nullable(v.number()),
  snapshot: VideoSnapshotSchema,
});

const VstatsSchema = v.object({
  updatedAt: v.optional(v.nullable(v.string())),
  startedAt: v.optional(v.nullable(v.string())),
  endedAt: v.optional(v.nullable(v.string())),
  durationText: v.optional(v.nullable(v.string())),
  maxConcurrent: v.optional(v.nullable(v.number())),
  maxConcurrentAt: v.optional(v.nullable(v.string())),
  avgConcurrent: v.optional(v.nullable(v.number())),
  watchTimeHours: v.optional(v.nullable(v.number())),
  views: v.optional(v.nullable(v.number())),
  likes: v.optional(v.nullable(v.number())),
});

const ChatDensitySchema = v.object({
  perMinuteMean: v.optional(v.nullable(v.number())),
  perMinute: v.array(v.number()),
  perMinuteSc: v.array(v.number()),
});

const AuthorStatSchema = v.object({
  author: v.string(),
  authorId: v.nullable(v.string()),
  messages: v.number(),
  superchats: v.number(),
  stickers: v.number(),
  memberships: v.number(),
});

const SuperchatSchema = v.object({
  at: v.string(),
  author: v.string(),
  amountText: v.string(),
  currency: v.string(),
  amount: v.number(),
  message: v.string(),
});

const DatapackChatSchema = v.object({
  total: v.number(),
  byKind: ChatByKindSchema,
  uniqueAuthors: v.number(),
  density: ChatDensitySchema,
  paid: v.object({
    superchats: v.array(SuperchatSchema),
    scTotalsByCurrency: CurrencyTotalsSchema,
  }),
  // v2 字段；v1 pack 没有，校验时按可选处理。
  authors: v.optional(v.array(AuthorStatSchema)),
  wordCounts: v.optional(v.record(v.string(), v.number())),
});

const CommentItemSchema = v.object({
  author: v.nullable(v.string()),
  authorId: v.nullable(v.string()),
  likes: v.number(),
  at: v.nullable(v.string()),
  pinned: v.boolean(),
  byUploader: v.boolean(),
  text: v.string(),
});

const DatapackCommentsSchema = v.object({
  total: v.number(),
  topLevel: v.number(),
  replies: v.number(),
  pinned: v.number(),
  totalLikes: v.number(),
  items: v.array(CommentItemSchema),
});

const DerivedSchema = v.object({
  chatPer1000AvgViewers: v.nullable(v.number()),
  likesPer1000Views: v.nullable(v.number()),
  scPerHour: v.nullable(v.number()),
  vstatsVsYtdlpViews: v.optional(v.nullable(v.number())),
});

export const DatapackSchema = v.object({
  schema: v.picklist(["yumemita.stream-datapack/v1", "yumemita.stream-datapack/v2"]),
  generatedAt: v.string(),
  video: DatapackVideoSchema,
  vstats: v.nullable(VstatsSchema),
  chat: DatapackChatSchema,
  comments: v.nullable(DatapackCommentsSchema),
  derived: DerivedSchema,
});

export const InsightsSchema = v.object({
  schema: v.string(),
  generatedAt: v.string(),
  totals: v.looseObject({
    streamCount: v.number(),
    chatTotal: v.number(),
  }),
});

export const GroupMemberStatSchema = v.object({
  datasetId: v.string(),
  streamCount: v.number(),
  chatTotal: v.number(),
  superchats: v.number(),
  durationSec: v.number(),
  avgConcurrent: v.nullable(v.number()),
});

export const GroupDayStatSchema = v.object({
  datasetId: v.string(),
  date: v.string(),
  streams: v.number(),
  chat: v.number(),
});

export const GroupStreamSchema = v.object({
  datasetId: v.string(),
  date: v.string(),
  videoId: v.string(),
  title: v.string(),
  startedAt: v.nullable(v.string()),
  durationSec: v.nullable(v.number()),
  availability: v.nullable(v.string()),
  avgConcurrent: v.nullable(v.number()),
  maxConcurrent: v.nullable(v.number()),
  chatTotal: v.number(),
  superchats: v.number(),
  vstatsViews: v.nullable(v.number()),
  snapshotViews: v.nullable(v.number()),
  thumbnail: v.optional(v.nullable(v.string())),
});

export const GroupSummarySchema = v.object({
  schema: v.string(),
  generatedAt: v.string(),
  members: v.array(GroupMemberStatSchema),
  days: v.array(GroupDayStatSchema),
  latest: v.array(GroupStreamSchema),
  recent: v.array(GroupStreamSchema),
});

export const GroupGallerySchema = v.object({
  schema: v.string(),
  generatedAt: v.string(),
  streams: v.array(GroupStreamSchema),
});

export function formatIssues(result: { readonly issues?: readonly v.GenericIssue[] }): string[] {
  return (result.issues ?? []).map((issue) => {
    const path = v.getDotPath(issue);
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}
