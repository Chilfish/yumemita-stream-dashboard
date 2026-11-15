import type {
  AuthorStat,
  ChatByKind,
  ChatDensity,
  ChatEvent,
  ChatInfo,
  CommentItem,
  CommentsInfo,
  CurrencyTotal,
  DerivedInfo,
  EmojiAsset,
  EmojiCount,
  EmojiKinds,
  GiftMembership,
  Membership,
  OwnerChat,
  PaidInfo,
  PeakMinute,
  Sticker,
  StreamDatapack,
  Superchat,
  TenMinuteBucket,
  TimeRange,
  TopAuthor,
  TopWord,
  VideoInfo,
  VideoSnapshot,
  VstatsInfo,
} from '@/types/datapack'
import type { TranscriptFrontmatter, TranscriptPayload } from '@/lib/transcripts'

/**
 * 对外发布的 JSON Schema（draft-07），给第三方 Agent 校验 `/api/*` 的响应。
 *
 * 真源是 `src/types/datapack.ts` 与 `src/lib/transcripts.ts`：这里用类型断言
 * 保证每个 `$defs` 的字段集合与对应 interface 完全一致，改类型而没改 schema 会编译失败。
 * 注意 v2 是 v1 的超集（v1 缺 `chat.authors` / `chat.wordCounts` / `topAuthors[].authorId`
 * 等），这些字段在 schema 里都是可选的，所以同一份 schema 也能校验 v1 payload。
 */

export type JsonSchema = Record<string, unknown>

export interface SchemaEntry {
  title: string
  summary: string
  schema: JsonSchema
}

type AssertSameKeys<SchemaKeys extends PropertyKey, TypeKeys extends PropertyKey> =
  [Exclude<SchemaKeys, TypeKeys>] extends [never]
    ? ([Exclude<TypeKeys, SchemaKeys>] extends [never]
        ? true
        : `schema 缺少字段：${Exclude<TypeKeys, SchemaKeys> & string}`)
    : `schema 多出字段：${Exclude<SchemaKeys, TypeKeys> & string}`

/**
 * 编译期一致性断言：每个 schema 的字段集合必须与对应 TypeScript 类型完全相等。
 * 改类型而没改 schema（多出或缺少字段）都会在这里编译失败。
 */
type AssertAllTrue<T extends readonly true[]> = T
export type SchemaKeyParity = AssertAllTrue<
  [
    AssertSameKeys<keyof typeof currencyTotal.properties, keyof CurrencyTotal>,
    AssertSameKeys<keyof typeof videoSnapshot.properties, keyof VideoSnapshot>,
    AssertSameKeys<keyof typeof video.properties, keyof VideoInfo>,
    AssertSameKeys<keyof typeof vstats.properties, keyof VstatsInfo>,
    AssertSameKeys<keyof typeof chatByKind.properties, keyof ChatByKind>,
    AssertSameKeys<keyof typeof timeRange.properties, keyof TimeRange>,
    AssertSameKeys<keyof typeof peakMinute.properties, keyof PeakMinute>,
    AssertSameKeys<keyof typeof tenMinuteBucket.properties, keyof TenMinuteBucket>,
    AssertSameKeys<keyof typeof chatDensity.properties, keyof ChatDensity>,
    AssertSameKeys<keyof typeof superchat.properties, keyof Superchat>,
    AssertSameKeys<keyof typeof emojiAsset.properties, keyof EmojiAsset>,
    AssertSameKeys<keyof typeof sticker.properties, keyof Sticker>,
    AssertSameKeys<keyof typeof membership.properties, keyof Membership>,
    AssertSameKeys<keyof typeof giftMembership.properties, keyof GiftMembership>,
    AssertSameKeys<keyof typeof paid.properties, keyof PaidInfo>,
    AssertSameKeys<keyof typeof topAuthor.properties, keyof TopAuthor>,
    AssertSameKeys<keyof typeof authorStat.properties, keyof AuthorStat>,
    AssertSameKeys<keyof typeof topWord.properties, keyof TopWord>,
    AssertSameKeys<keyof typeof emojiCount.properties, keyof EmojiCount>,
    AssertSameKeys<keyof typeof emojiKinds.properties, keyof EmojiKinds>,
    AssertSameKeys<keyof typeof ownerChat.properties, keyof OwnerChat>,
    AssertSameKeys<keyof typeof chatEvent.properties, keyof ChatEvent>,
    AssertSameKeys<keyof typeof chat.properties, keyof ChatInfo>,
    AssertSameKeys<keyof typeof commentItem.properties, keyof CommentItem>,
    AssertSameKeys<keyof typeof comments.properties, keyof CommentsInfo>,
    AssertSameKeys<keyof typeof derived.properties, keyof DerivedInfo>,
    AssertSameKeys<keyof typeof datapackSchema.properties, keyof StreamDatapack>,
    AssertSameKeys<keyof typeof transcriptFrontmatter.properties, keyof TranscriptFrontmatter>,
    AssertSameKeys<keyof typeof transcriptSchema.properties, keyof TranscriptPayload>,
  ]
>

const nullableString = { type: ['string', 'null'] } as const
const nullableNumber = { type: ['number', 'null'] } as const
const arrayOf = (items: JsonSchema) => ({ type: 'array', items }) as const
const ref = (name: string) => ({ $ref: `#/$defs/${name}` }) as const
const nullableRef = (name: string) => ({ oneOf: [ref(name), { type: 'null' }] }) as const
const numberRecord = { type: 'object', additionalProperties: { type: 'number' } } as const

const currencyTotal = {
  type: 'object',
  additionalProperties: false,
  required: ['count', 'amount'],
  properties: { count: { type: 'number' }, amount: { type: 'number' } },
} as const
const videoSnapshot = {
  type: 'object',
  additionalProperties: false,
  required: ['views', 'likes', 'comments'],
  properties: { views: nullableNumber, likes: nullableNumber, comments: nullableNumber },
} as const
const video = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'url',
    'title',
    'channelId',
    'channelName',
    'channelUrl',
    'channelFollowersAtCapture',
    'liveStatus',
    'availability',
    'startedAt',
    'publishedAt',
    'durationSec',
    'durationHms',
    'endedAt',
    'thumbnail',
    'description',
    'links',
    'chapters',
    'hasLiveChatReplay',
    'captionsJa',
    'snapshot',
  ],
  properties: {
    id: { type: 'string' },
    url: { type: 'string' },
    title: nullableString,
    channelId: nullableString,
    channelName: nullableString,
    channelUrl: nullableString,
    channelFollowersAtCapture: nullableNumber,
    liveStatus: nullableString,
    availability: nullableString,
    startedAt: nullableString,
    publishedAt: nullableString,
    durationSec: nullableNumber,
    durationHms: nullableString,
    endedAt: nullableString,
    thumbnail: nullableString,
    description: nullableString,
    links: arrayOf({ type: 'string' }),
    chapters: arrayOf({
      type: 'object',
      additionalProperties: false,
      properties: { title: { type: 'string' }, start_time: { type: 'number' } },
    }),
    hasLiveChatReplay: { type: 'boolean' },
    captionsJa: { type: 'boolean' },
    snapshot: ref('videoSnapshot'),
  },
} as const
const vstats = {
  type: 'object',
  additionalProperties: false,
  required: [
    'updatedAt',
    'startedAt',
    'endedAt',
    'durationText',
    'maxConcurrent',
    'maxConcurrentAt',
    'avgConcurrent',
    'watchTimeHours',
    'views',
    'likes',
  ],
  properties: {
    updatedAt: nullableString,
    startedAt: nullableString,
    endedAt: nullableString,
    durationText: nullableString,
    maxConcurrent: nullableNumber,
    maxConcurrentAt: nullableString,
    avgConcurrent: nullableNumber,
    watchTimeHours: nullableNumber,
    views: nullableNumber,
    likes: nullableNumber,
  },
} as const
const chatByKind = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'superchat', 'sticker', 'membership'],
  properties: {
    text: { type: 'number' },
    superchat: { type: 'number' },
    sticker: { type: 'number' },
    membership: { type: 'number' },
    gift: { type: 'number' },
  },
} as const
const timeRange = {
  type: 'object',
  additionalProperties: false,
  required: ['firstAt', 'lastAt', 'preRollSec'],
  properties: {
    firstAt: nullableString,
    lastAt: nullableString,
    preRollSec: nullableNumber,
  },
} as const
const peakMinute = {
  type: 'object',
  additionalProperties: false,
  required: ['offsetMin', 'at', 'count'],
  properties: { offsetMin: { type: 'number' }, at: nullableString, count: { type: 'number' } },
} as const
const tenMinuteBucket = {
  type: 'object',
  additionalProperties: false,
  required: ['offsetMin', 'at', 'messages', 'superchats'],
  properties: {
    offsetMin: { type: 'number' },
    at: nullableString,
    messages: { type: 'number' },
    superchats: { type: 'number' },
  },
} as const
const chatDensity = {
  type: 'object',
  additionalProperties: false,
  required: ['perMinuteMean', 'peakMinute', 'perMinute', 'perMinuteSc', 'perFiveMinute', 'perTenMinute'],
  properties: {
    perMinuteMean: nullableNumber,
    peakMinute: nullableRef('peakMinute'),
    perMinute: arrayOf({ type: 'number' }),
    perMinuteSc: arrayOf({ type: 'number' }),
    perFiveMinute: arrayOf({ type: 'number' }),
    perTenMinute: arrayOf(ref('tenMinuteBucket')),
  },
} as const
const superchat = {
  type: 'object',
  additionalProperties: false,
  required: ['at', 'author', 'amountText', 'currency', 'amount', 'message'],
  properties: {
    at: { type: 'string' },
    author: { type: 'string' },
    amountText: { type: 'string' },
    currency: { type: 'string' },
    amount: { type: 'number' },
    message: { type: 'string' },
    emojis: arrayOf({ type: 'string' }),
  },
} as const
const emojiAsset = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'url'],
  properties: { id: { type: 'string' }, name: nullableString, url: { type: 'string' } },
} as const
const sticker = {
  type: 'object',
  additionalProperties: false,
  required: ['at', 'author', 'amountText', 'currency', 'amount'],
  properties: {
    at: { type: 'string' },
    author: { type: 'string' },
    amountText: { type: 'string' },
    currency: { type: 'string' },
    amount: { type: 'number' },
  },
} as const
const membership = {
  type: 'object',
  additionalProperties: false,
  required: ['at', 'author', 'header'],
  properties: {
    at: { type: 'string' },
    author: { type: 'string' },
    header: nullableString,
  },
} as const
const giftMembership = {
  type: 'object',
  additionalProperties: false,
  required: ['at', 'author', 'count', 'text'],
  properties: {
    at: { type: 'string' },
    author: { type: 'string' },
    count: { type: 'number' },
    text: { type: 'string' },
  },
} as const
const paid = {
  type: 'object',
  additionalProperties: false,
  required: [
    'superchats',
    'scTotalsByCurrency',
    'stickers',
    'stickerTotalsByCurrency',
    'memberships',
    'paidSharePct',
  ],
  properties: {
    superchats: arrayOf(ref('superchat')),
    scTotalsByCurrency: { type: 'object', additionalProperties: ref('currencyTotal') },
    stickers: arrayOf(ref('sticker')),
    stickerTotalsByCurrency: { type: 'object', additionalProperties: ref('currencyTotal') },
    memberships: arrayOf(ref('membership')),
    gifts: arrayOf(ref('giftMembership')),
    paidSharePct: nullableNumber,
  },
} as const
const topAuthor = {
  type: 'object',
  additionalProperties: false,
  required: ['author', 'messages', 'superchats', 'stickers', 'memberships', 'badges'],
  properties: {
    author: { type: 'string' },
    authorId: nullableString,
    messages: { type: 'number' },
    superchats: { type: 'number' },
    stickers: { type: 'number' },
    memberships: { type: 'number' },
    badges: arrayOf({ type: 'string' }),
  },
} as const
const authorStat = {
  type: 'object',
  additionalProperties: false,
  required: ['author', 'authorId', 'messages', 'superchats', 'stickers', 'memberships'],
  properties: {
    author: { type: 'string' },
    authorId: nullableString,
    messages: { type: 'number' },
    superchats: { type: 'number' },
    stickers: { type: 'number' },
    memberships: { type: 'number' },
  },
} as const
const topWord = {
  type: 'object',
  additionalProperties: false,
  required: ['word', 'count'],
  properties: { word: { type: 'string' }, count: { type: 'number' } },
} as const
const emojiCount = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'count'],
  properties: { id: { type: 'string' }, count: { type: 'number' } },
} as const
const emojiKinds = {
  type: 'object',
  additionalProperties: false,
  required: ['distinct', 'top'],
  properties: { distinct: { type: 'number' }, top: arrayOf(ref('emojiCount')) },
} as const
const ownerChat = {
  type: 'object',
  additionalProperties: false,
  required: ['at', 'kind', 'text'],
  properties: {
    at: { type: 'string' },
    kind: { type: 'string', enum: ['text', 'superchat', 'sticker', 'membership', 'gift', 'event'] },
    text: { type: 'string' },
    emojis: arrayOf({ type: 'string' }),
  },
} as const
const chatEvent = {
  type: 'object',
  additionalProperties: false,
  required: ['at', 'type', 'owner', 'text'],
  properties: {
    at: { type: 'string' },
    type: {
      type: 'string',
      enum: [
        'banner',
        'bannerRemoved',
        'poll',
        'pollUpdate',
        'qna',
        'product',
        'system',
        'modeChange',
        'deleted',
        'deletedAuthor',
        'replaced',
        'panel',
        'other',
      ],
    },
    owner: { type: 'boolean' },
    author: { type: 'string' },
    authorId: { type: 'string' },
    text: nullableString,
    data: { type: 'object' },
  },
} as const
const chat = {
  type: 'object',
  additionalProperties: false,
  required: [
    'total',
    'byKind',
    'pureEmojiOnly',
    'uniqueAuthors',
    'ownerMessages',
    'badges',
    'timeRange',
    'coveragePct',
    'density',
    'paid',
    'topAuthors',
    'topWords',
    'hashtags',
    'emojiKinds',
  ],
  properties: {
    total: { type: 'number' },
    byKind: ref('chatByKind'),
    pureEmojiOnly: { type: 'number' },
    uniqueAuthors: { type: 'number' },
    ownerMessages: { type: 'number' },
    badges: numberRecord,
    timeRange: ref('timeRange'),
    coveragePct: nullableNumber,
    density: ref('chatDensity'),
    paid: ref('paid'),
    topAuthors: arrayOf(ref('topAuthor')),
    topWords: arrayOf(ref('topWord')),
    authors: arrayOf(ref('authorStat')),
    wordCounts: numberRecord,
    hashtags: numberRecord,
    emojiKinds: ref('emojiKinds'),
    emojis: arrayOf(ref('emojiAsset')),
    ownerChats: arrayOf(ref('ownerChat')),
    events: arrayOf(ref('chatEvent')),
  },
} as const
const commentItem = {
  type: 'object',
  additionalProperties: false,
  required: ['author', 'authorId', 'likes', 'at', 'pinned', 'byUploader', 'text'],
  properties: {
    author: nullableString,
    authorId: nullableString,
    likes: { type: 'number' },
    at: nullableString,
    pinned: { type: 'boolean' },
    byUploader: { type: 'boolean' },
    text: { type: 'string' },
  },
} as const
const comments = {
  type: 'object',
  additionalProperties: false,
  required: ['total', 'topLevel', 'replies', 'pinned', 'totalLikes', 'items'],
  properties: {
    total: { type: 'number' },
    topLevel: { type: 'number' },
    replies: { type: 'number' },
    pinned: { type: 'number' },
    totalLikes: { type: 'number' },
    items: arrayOf(ref('commentItem')),
  },
} as const
const derived = {
  type: 'object',
  additionalProperties: false,
  required: ['chatPer1000AvgViewers', 'likesPer1000Views', 'scPerHour'],
  properties: {
    chatPer1000AvgViewers: nullableNumber,
    likesPer1000Views: nullableNumber,
    scPerHour: nullableNumber,
    vstatsVsYtdlpViews: nullableNumber,
  },
} as const
const datapackSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'yumemita.stream-datapack',
  description:
    '一场直播的完整数据包（v2；v1 缺少 chat.authors、chat.wordCounts、topAuthors[].authorId 等可选字段）。',
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'generatedAt', 'video', 'vstats', 'chat', 'comments', 'derived'],
  properties: {
    schema: { type: 'string', enum: ['yumemita.stream-datapack/v1', 'yumemita.stream-datapack/v2'] },
    generatedAt: { type: 'string' },
    video: ref('video'),
    vstats: nullableRef('vstats'),
    chat: ref('chat'),
    comments: nullableRef('comments'),
    derived: ref('derived'),
  },
  $defs: {
    currencyTotal,
    videoSnapshot,
    video,
    vstats,
    chatByKind,
    timeRange,
    peakMinute,
    tenMinuteBucket,
    chatDensity,
    superchat,
    emojiAsset,
    sticker,
    membership,
    giftMembership,
    paid,
    topAuthor,
    authorStat,
    topWord,
    emojiCount,
    emojiKinds,
    ownerChat,
    chatEvent,
    chat,
    commentItem,
    comments,
    derived,
  },
} as const
const transcriptFrontmatter = {
  type: 'object',
  additionalProperties: false,
  required: ['videoId', 'date', 'title', 'members', 'tags', 'membersOnly', 'summary', 'tweets'],
  properties: {
    videoId: { type: 'string' },
    date: nullableString,
    title: nullableString,
    members: arrayOf({ type: 'string' }),
    tags: arrayOf({ type: 'string' }),
    membersOnly: { type: 'boolean' },
    summary: nullableString,
    tweets: arrayOf({ type: 'string' }),
  },
} as const
const transcriptSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'yumemita.transcript',
  description: '一篇逐字稿的正文与元数据；markdown 保留原始 [hh:mm:ss] 时间码。',
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'datasetId', 'videoId', 'frontmatter', 'markdown', 'updatedAt'],
  properties: {
    schema: { type: 'string', enum: ['yumemita.transcript/v1'] },
    datasetId: { type: 'string' },
    videoId: { type: 'string' },
    frontmatter: ref('frontmatter'),
    markdown: { type: 'string' },
    updatedAt: { type: 'string' },
  },
  $defs: { frontmatter: transcriptFrontmatter },
} as const
const densitiesSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'yumemita.densities',
  description:
    '对照页按需补拉的逐分钟弹幕密度。densities 的数组下标＝开播后第几分钟；locked 是被会员限定挡下的场次。',
  type: 'object',
  additionalProperties: false,
  required: ['densities', 'locked'],
  properties: {
    densities: { type: 'object', additionalProperties: arrayOf({ type: 'number' }) },
    locked: arrayOf({ type: 'string' }),
  },
} as const

export const SCHEMAS = {
  'stream-datapack.v2': {
    title: '单场完整 datapack',
    summary: '`/api/packs/<datasetId>/<videoId>` 的响应结构，同时用于校验离线 pack 文件。',
    schema: datapackSchema,
  },
  'transcript.v1': {
    title: '逐字稿正文',
    summary: '`/api/transcripts/<datasetId>/<videoId>` 的响应结构。',
    schema: transcriptSchema,
  },
  'densities.v1': {
    title: '逐分钟弹幕密度',
    summary: '`/api/densities/<datasetId>?ids=...` 的响应结构。',
    schema: densitiesSchema,
  },
} satisfies Record<string, SchemaEntry>

export type SchemaName = keyof typeof SCHEMAS
