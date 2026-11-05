import type { DatasetTotals } from '@/lib/aggregate'
import type { ChatByKind, CurrencyTotals } from './datapack'
import type { StreamSummary } from './dataset'

/** 数据库查询返回的可序列化 DTO；岛屿 props 直接消费。 */

export interface DatasetSummary {
  id: string
  label: string
  color: string | null
  avatarKey: string | null
  channelId: string | null
  subject: string | null
  scope: string | null
  note: string | null
  streamCount: number
  generatedAt: string | null
}

export interface StreamListOptions {
  limit?: number
  offset?: number
  availability?: string
  /** 默认 true；页面只渲染当前页时关掉窗口计数，让查询提前结束。 */
  withTotal?: boolean
}

export interface StreamListResult {
  streams: StreamSummary[]
  total: number
}

export interface StreamNeighbors {
  previous: StreamSummary | null
  next: StreamSummary | null
}

export interface StreamDetailDto {
  summary: StreamSummary
  density: unknown
  coveragePct: number | null
  timeRange: unknown
  badges: unknown
  hashtags: unknown
  emojiKinds: unknown
  ownerChats: unknown
  emojis: unknown
  videoExtra: unknown
}

export interface DatasetInsightDto {
  datasetId: string
  totals: DatasetTotals
  generatedAt: string | null
}

/** 查询层内部使用的行投影，避免把 Drizzle 类型漏到页面。 */
export interface StreamDbRow {
  id: number
  datasetId: string
  videoId: string
  title: string
  url: string
  date: string | null
  startedAt: Date | null
  endedAt: Date | null
  durationSec: number | null
  durationHms: string | null
  availability: string | null
  avgConcurrent: string | null
  maxConcurrent: number | null
  maxConcurrentAt: string | null
  watchTimeHours: string | null
  vstatsViews: number | null
  vstatsLikes: number | null
  snapshotViews: number | null
  snapshotLikes: number | null
  snapshotComments: number | null
  chatTotal: number
  chatByKind: unknown
  pureEmojiOnly: number
  uniqueAuthors: number
  superchats: number
  stickers: number
  memberships: number
  gifts: number
  giftedMemberships: number
  scTotalsByCurrency: unknown
  commentsCaptured: number | null
  chatPer1000AvgViewers: string | null
  likesPer1000Views: string | null
  scPerHour: string | null
  thumbnailKey: string | null
  sourceGeneratedAt: Date | null
  updatedAt: Date
}

export type { ChatByKind, CurrencyTotals }
