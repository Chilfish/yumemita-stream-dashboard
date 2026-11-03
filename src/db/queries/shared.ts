import type { ChatByKind, CurrencyTotals } from '@/types/datapack'
import type { StreamSummary } from '@/types/dataset'
import type { StreamDbRow } from '@/types/db'

export function toNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

/**
 * Neon HTTP 对时间列可能返回字符串而不是 Date；这里统一成 ISO 字符串。
 * 岛屿 props 只接受可序列化值，页面不会再拿到 Date。
 */
export function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

export function mapStreamSummary(row: StreamDbRow, rank: number): StreamSummary {
  return {
    rank,
    date: row.date ?? '',
    videoId: row.videoId,
    title: row.title,
    url: row.url,
    durationHms: row.durationHms,
    durationSec: row.durationSec,
    startedAt: toIso(row.startedAt),
    endedAt: toIso(row.endedAt),
    availability: row.availability,
    avgConcurrent: toNumber(row.avgConcurrent),
    maxConcurrent: row.maxConcurrent,
    maxConcurrentAt: row.maxConcurrentAt,
    watchTimeHours: toNumber(row.watchTimeHours),
    vstatsViews: row.vstatsViews,
    vstatsLikes: row.vstatsLikes,
    snapshotViews: row.snapshotViews,
    snapshotLikes: row.snapshotLikes,
    snapshotComments: row.snapshotComments,
    chatTotal: row.chatTotal,
    chatByKind: (row.chatByKind ?? {}) as ChatByKind,
    pureEmojiOnly: row.pureEmojiOnly,
    uniqueAuthors: row.uniqueAuthors,
    superchats: row.superchats,
    scTotalsByCurrency: (row.scTotalsByCurrency ?? {}) as CurrencyTotals,
    stickers: row.stickers,
    memberships: row.memberships,
    gifts: row.gifts,
    giftedMemberships: row.giftedMemberships,
    commentsCaptured: row.commentsCaptured,
    chatPer1000AvgViewers: toNumber(row.chatPer1000AvgViewers),
    likesPer1000Views: toNumber(row.likesPer1000Views),
    scPerHour: toNumber(row.scPerHour),
    thumbnail: row.thumbnailKey,
    sessionDir: '',
    datapack: '',
    generatedAt: toIso(row.sourceGeneratedAt) ?? '',
  }
}
