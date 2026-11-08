import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const datasets = pgTable('datasets', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  color: text('color'),
  avatarKey: text('avatar_key'),
  channelId: text('channel_id'),
  subject: text('subject'),
  scope: text('scope'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const streams = pgTable(
  'streams',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    datasetId: text('dataset_id')
      .notNull()
      .references(() => datasets.id, { onDelete: 'cascade' }),
    videoId: text('video_id').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull(),
    date: date('date'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    durationSec: integer('duration_sec'),
    durationHms: text('duration_hms'),
    availability: text('availability'),
    avgConcurrent: numeric('avg_concurrent'),
    maxConcurrent: integer('max_concurrent'),
    maxConcurrentAt: text('max_concurrent_at'),
    watchTimeHours: numeric('watch_time_hours'),
    vstatsViews: integer('vstats_views'),
    vstatsLikes: integer('vstats_likes'),
    snapshotViews: integer('snapshot_views'),
    snapshotLikes: integer('snapshot_likes'),
    snapshotComments: integer('snapshot_comments'),
    chatTotal: integer('chat_total').notNull().default(0),
    chatByKind: jsonb('chat_by_kind'),
    pureEmojiOnly: integer('pure_emoji_only').notNull().default(0),
    uniqueAuthors: integer('unique_authors').notNull().default(0),
    superchats: integer('superchats').notNull().default(0),
    stickers: integer('stickers').notNull().default(0),
    memberships: integer('memberships').notNull().default(0),
    gifts: integer('gifts').notNull().default(0),
    giftedMemberships: integer('gifted_memberships').notNull().default(0),
    scTotalsByCurrency: jsonb('sc_totals_by_currency'),
    commentsCaptured: integer('comments_captured'),
    chatPer1000AvgViewers: numeric('chat_per_1000_avg_viewers'),
    likesPer1000Views: numeric('likes_per_1000_views'),
    scPerHour: numeric('sc_per_hour'),
    paidSharePct: numeric('paid_share_pct'),
    thumbnailKey: text('thumbnail_key'),
    sourceGeneratedAt: timestamp('source_generated_at', { withTimezone: true }),
    sourceSchema: text('source_schema'),
    contentHash: text('content_hash'),
    ingestBatchId: bigint('ingest_batch_id', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('streams_dataset_video_unique').on(table.datasetId, table.videoId),
    index('streams_dataset_started_idx').on(table.datasetId, table.startedAt.desc()),
    index('streams_dataset_date_idx').on(table.datasetId, table.date.desc()),
    index('streams_dataset_availability_idx').on(table.datasetId, table.availability),
  ],
)

/**
 * 直播日历里的未来场次。与 `streams` 平行：这里只存还没结束的安排，
 * 开播结束后由每日任务照常写入 `streams`，日历读取时按 video_id 关联。
 */
export const scheduledStreams = pgTable(
  'scheduled_streams',
  {
    datasetId: text('dataset_id')
      .notNull()
      .references(() => datasets.id, { onDelete: 'cascade' }),
    /** `yt:<videoId>` 或 `manual:<id>`；有 videoId 时统一用前者。 */
    eventKey: text('event_key').notNull(),
    videoId: text('video_id'),
    /** ingest 已找到对应 `streams` 行时写入 videoId；读取时优先据此判定已结束。 */
    supersededBy: text('superseded_by'),
    title: text('title').notNull(),
    url: text('url'),
    /** JST 自然日；只知道日期和时段时由管理端写入。 */
    date: date('date'),
    /** `early` / `mid` / `late`；精确时间已知时可直接派生。 */
    slot: text('slot'),
    /** `sing` / `event` / `talk` / `game`，与内容分类口径一致。 */
    kind: text('kind'),
    /** 提前放出的封面，存 `images/temp-thumbs/...`；与正式存档封面分开。 */
    thumbnailKey: text('thumbnail_key'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    expectedMinutes: integer('expected_minutes'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    availability: text('availability'),
    source: text('source').notNull().default('manual'),
    note: text('note'),
    /** 最近一次在频道列表里看到的时间，用于清理自动行。 */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /** 最近一次频道检查报告 `is_live` 的时间，用于派生「直播中」。 */
    lastLiveAt: timestamp('last_live_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    primaryKey({ columns: [table.datasetId, table.eventKey] }),
    uniqueIndex('scheduled_streams_video_unique')
      .on(table.datasetId, table.videoId)
      .where(sql`${table.videoId} is not null`),
    index('scheduled_streams_at_idx').on(table.scheduledAt),
    index('scheduled_streams_dataset_at_idx').on(table.datasetId, table.scheduledAt),
    index('scheduled_streams_dataset_date_idx').on(table.datasetId, table.date),
  ],
)

export const streamDetails = pgTable('stream_details', {
  streamId: bigint('stream_id', { mode: 'number' })
    .primaryKey()
    .references(() => streams.id, { onDelete: 'cascade' }),
  density: jsonb('density'),
  coveragePct: numeric('coverage_pct'),
  timeRange: jsonb('time_range'),
  badges: jsonb('badges'),
  hashtags: jsonb('hashtags'),
  emojiKinds: jsonb('emoji_kinds'),
  ownerChats: jsonb('owner_chats'),
  emojis: jsonb('emojis'),
  events: jsonb('events'),
  videoExtra: jsonb('video_extra'),
  rawDetail: jsonb('raw_detail'),
})

export const paidEvents = pgTable(
  'paid_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    streamId: bigint('stream_id', { mode: 'number' })
      .notNull()
      .references(() => streams.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    at: timestamp('at', { withTimezone: true }),
    author: text('author'),
    authorId: text('author_id'),
    amountText: text('amount_text'),
    currency: text('currency'),
    amount: numeric('amount'),
    message: text('message'),
    emojis: jsonb('emojis'),
  },
  table => [
    index('paid_events_stream_kind_idx').on(table.streamId, table.kind),
    index('paid_events_stream_at_idx').on(table.streamId, table.at),
  ],
)

export const comments = pgTable(
  'comments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    streamId: bigint('stream_id', { mode: 'number' })
      .notNull()
      .references(() => streams.id, { onDelete: 'cascade' }),
    author: text('author'),
    authorId: text('author_id'),
    likes: integer('likes').notNull().default(0),
    at: timestamp('at', { withTimezone: true }),
    pinned: boolean('pinned').notNull().default(false),
    byUploader: boolean('by_uploader').notNull().default(false),
    text: text('text').notNull(),
  },
  table => [index('comments_stream_likes_idx').on(table.streamId, table.likes.desc())],
)

export const authors = pgTable('authors', {
  authorId: text('author_id').primaryKey(),
  name: text('name'),
  firstSeen: timestamp('first_seen', { withTimezone: true }),
  lastSeen: timestamp('last_seen', { withTimezone: true }),
})

export const streamAuthors = pgTable(
  'stream_authors',
  {
    streamId: bigint('stream_id', { mode: 'number' })
      .notNull()
      .references(() => streams.id, { onDelete: 'cascade' }),
    authorId: text('author_id').notNull(),
    messages: integer('messages').notNull().default(0),
    superchats: integer('superchats').notNull().default(0),
    stickers: integer('stickers').notNull().default(0),
    memberships: integer('memberships').notNull().default(0),
  },
  table => [
    primaryKey({ columns: [table.streamId, table.authorId] }),
    index('stream_authors_author_idx').on(table.authorId),
    index('stream_authors_stream_messages_idx').on(table.streamId, table.messages.desc()),
  ],
)

export const streamWords = pgTable(
  'stream_words',
  {
    streamId: bigint('stream_id', { mode: 'number' })
      .notNull()
      .references(() => streams.id, { onDelete: 'cascade' }),
    word: text('word').notNull(),
    count: integer('count').notNull(),
  },
  table => [
    primaryKey({ columns: [table.streamId, table.word] }),
    index('stream_words_word_idx').on(table.word),
  ],
)

export const datasetInsights = pgTable('dataset_insights', {
  datasetId: text('dataset_id')
    .primaryKey()
    .references(() => datasets.id, { onDelete: 'cascade' }),
  totals: jsonb('totals').notNull(),
  /**
   * 公开页面口径：会员限定场只计场次数，派生指标按公开场次聚合。
   * 请求期只读这一行，避免再加载整份详情。
   */
  publicTotals: jsonb('public_totals'),
  aggregation: jsonb('aggregation'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const transcripts = pgTable(
  'transcripts',
  {
    datasetId: text('dataset_id')
      .notNull()
      .references(() => datasets.id, { onDelete: 'cascade' }),
    videoId: text('video_id').notNull(),
    r2Key: text('r2_key').notNull(),
    title: text('title'),
    date: date('date'),
    summary: text('summary'),
    tags: text('tags').array(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    contentHash: text('content_hash'),
  },
  table => [
    primaryKey({ columns: [table.datasetId, table.videoId] }),
    index('transcripts_dataset_date_idx').on(table.datasetId, table.date.desc()),
  ],
)

export const ingestReports = pgTable('ingest_reports', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull(),
  datasets: jsonb('datasets'),
  newIds: text('new_ids').array(),
  forceIds: text('force_ids').array(),
  failures: integer('failures').notNull().default(0),
  structural: boolean('structural').notNull().default(false),
  notes: text('notes'),
})

export type DatasetRow = typeof datasets.$inferSelect
export type StreamRow = typeof streams.$inferSelect
export type ScheduledStreamRow = typeof scheduledStreams.$inferSelect
export type StreamDetailsRow = typeof streamDetails.$inferSelect
export type PaidEventRow = typeof paidEvents.$inferSelect
export type CommentRow = typeof comments.$inferSelect
export type AuthorRow = typeof authors.$inferSelect
export type StreamAuthorRow = typeof streamAuthors.$inferSelect
export type StreamWordRow = typeof streamWords.$inferSelect
export type DatasetInsightsRow = typeof datasetInsights.$inferSelect
export type TranscriptRow = typeof transcripts.$inferSelect
export type IngestReportRow = typeof ingestReports.$inferSelect
