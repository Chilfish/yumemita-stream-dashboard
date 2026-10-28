/**
 * manifest 摘要的单一来源：`add-datapack.mjs` 与 `stream-datapack.ts` 共用。
 *
 * 摘要字段与 `src/types/dataset.ts` 的 `StreamSummary`、`docs/data-model.md` 对齐；
 * 新增字段时只改这里，避免两个入口各写一份后漂移。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { ChatByKind, CurrencyTotals } from '../../src/types/datapack.ts'

export const MANIFEST_SCHEMA = 'yumemita.stream-datapack.batch/v1'
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

export interface StreamSummary {
  rank: number
  date: string
  videoId: string
  title: string
  url: string
  durationHms: string | null
  durationSec: number | null
  startedAt: string | null
  endedAt: string | null
  availability: string | null
  avgConcurrent: number | null
  maxConcurrent: number | null
  maxConcurrentAt: string | null
  watchTimeHours: number | null
  vstatsViews: number | null
  vstatsLikes: number | null
  snapshotViews: number | null
  snapshotLikes: number | null
  snapshotComments: number | null
  chatTotal: number
  chatByKind: ChatByKind
  pureEmojiOnly: number
  uniqueAuthors: number
  superchats: number
  scTotalsByCurrency: CurrencyTotals
  stickers: number
  memberships: number
  commentsCaptured: number | null
  chatPer1000AvgViewers: number | null
  likesPer1000Views: number | null
  scPerHour: number | null
  sessionDir: string
  datapack: string
  generatedAt: string
}

export interface ManifestFile {
  schema?: string
  generatedAt?: string
  subject?: string
  channelId?: string
  scope?: string
  count?: number
  note?: string
  streams?: StreamSummary[]
  [key: string]: unknown
}

export interface DatapackSummarySource {
  generatedAt?: string | null
  video: {
    id?: string | null
    title?: string | null
    url?: string | null
    startedAt?: string | null
    endedAt?: string | null
    durationSec?: number | null
    durationHms?: string | null
    availability?: string | null
    snapshot?: {
      views?: number | null
      likes?: number | null
      comments?: number | null
    } | null
  }
  vstats?: {
    avgConcurrent?: number | null
    maxConcurrent?: number | null
    maxConcurrentAt?: string | null
    watchTimeHours?: number | null
    views?: number | null
    likes?: number | null
  } | null
  chat: {
    total: number
    byKind: ChatByKind
    pureEmojiOnly: number
    uniqueAuthors: number
    paid: {
      superchats: unknown[]
      scTotalsByCurrency: CurrencyTotals
      stickers: unknown[]
      memberships: unknown[]
    }
  }
  comments?: { total?: number | null } | null
  derived?: {
    chatPer1000AvgViewers?: number | null
    likesPer1000Views?: number | null
    scPerHour?: number | null
  } | null
}

export function isoJst(date: Date): string {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().replace('Z', '+09:00')
}

export function buildStreamSummary(pack: DatapackSummarySource, datapackRel: string): StreamSummary {
  const video = pack.video
  const vstats = pack.vstats ?? null
  const chat = pack.chat

  return {
    rank: 0,
    date: (video.startedAt ?? '').slice(0, 10),
    videoId: video.id ?? '',
    title: video.title ?? '',
    url: video.url ?? `https://www.youtube.com/watch?v=${video.id ?? ''}`,
    durationHms: video.durationHms ?? null,
    durationSec: video.durationSec ?? null,
    startedAt: video.startedAt ?? null,
    endedAt: video.endedAt ?? null,
    availability: video.availability ?? null,
    avgConcurrent: vstats?.avgConcurrent ?? null,
    maxConcurrent: vstats?.maxConcurrent ?? null,
    maxConcurrentAt: vstats?.maxConcurrentAt ?? null,
    watchTimeHours: vstats?.watchTimeHours ?? null,
    vstatsViews: vstats?.views ?? null,
    vstatsLikes: vstats?.likes ?? null,
    snapshotViews: video.snapshot?.views ?? null,
    snapshotLikes: video.snapshot?.likes ?? null,
    snapshotComments: video.snapshot?.comments ?? null,
    chatTotal: chat.total,
    chatByKind: chat.byKind,
    pureEmojiOnly: chat.pureEmojiOnly,
    uniqueAuthors: chat.uniqueAuthors,
    superchats: chat.paid.superchats.length,
    scTotalsByCurrency: chat.paid.scTotalsByCurrency,
    stickers: chat.paid.stickers.length,
    memberships: chat.paid.memberships.length,
    commentsCaptured: pack.comments?.total ?? null,
    chatPer1000AvgViewers: pack.derived?.chatPer1000AvgViewers ?? null,
    likesPer1000Views: pack.derived?.likesPer1000Views ?? null,
    scPerHour: pack.derived?.scPerHour ?? null,
    sessionDir: '',
    datapack: datapackRel,
    generatedAt: pack.generatedAt ?? isoJst(new Date()),
  }
}

/** 按 videoId upsert，按开播时间倒序重排 rank，顺带更新 count / generatedAt。 */
export function upsertManifestStream(
  manifestPath: string,
  pack: DatapackSummarySource,
  datapackRel: string,
): { count: number, videoId: string } {
  const manifest: ManifestFile = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestFile)
    : { schema: MANIFEST_SCHEMA, streams: [] }
  const videoId = pack.video.id
  if (!videoId)
    throw new Error('datapack 缺少 video.id')

  const summary = buildStreamSummary(pack, datapackRel)
  const streams = (manifest.streams ?? []).filter(item => item.videoId !== videoId)
  streams.push(summary)
  streams.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
  streams.forEach((item, index) => {
    item.rank = index + 1
  })

  manifest.streams = streams
  manifest.count = streams.length
  manifest.generatedAt = isoJst(new Date())

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return { count: streams.length, videoId }
}
