import { and, eq, getTableColumns, sql } from 'drizzle-orm'
import type { Db } from '@/db/connection'
import { streams, transcripts } from '@/db/schema'
import { MEMBER_ONLY_AVAILABILITY } from '@/lib/visibility'
import type { TranscriptIndexEntry } from '@/lib/transcripts'
import { toIso } from './shared'

export interface TranscriptMeta {
  datasetId: string
  videoId: string
  r2Key: string
  title: string | null
  date: string | null
  summary: string | null
  tags: string[]
  updatedAt: string | null
}

const NEWEST_FIRST = sql`${transcripts.date} desc nulls last`

function toMeta(row: typeof transcripts.$inferSelect): TranscriptMeta {
  return {
    datasetId: row.datasetId,
    videoId: row.videoId,
    r2Key: row.r2Key,
    title: row.title,
    date: row.date ?? null,
    summary: row.summary,
    tags: row.tags ?? [],
    updatedAt: toIso(row.updatedAt),
  }
}

function toIndexEntry(row: typeof transcripts.$inferSelect): TranscriptIndexEntry {
  return {
    datasetId: row.datasetId,
    videoId: row.videoId,
    date: row.date ?? null,
    title: row.title ?? row.videoId,
    tags: row.tags ?? [],
    summary: row.summary,
    updatedAt: toIso(row.updatedAt) ?? '',
  }
}

export async function getTranscriptIndex(
  db: Db,
  datasetId: string,
  options: { includeMemberOnly?: boolean } = {},
): Promise<TranscriptIndexEntry[]> {
  // 逐字稿跟着场次的公开范围走：会员限定场即使有稿也不出现在公开索引。
  const rows = await db
    .select(getTableColumns(transcripts))
    .from(transcripts)
    .innerJoin(
      streams,
      and(
        eq(streams.datasetId, transcripts.datasetId),
        eq(streams.videoId, transcripts.videoId),
      ),
    )
    .where(and(
      eq(transcripts.datasetId, datasetId),
      options.includeMemberOnly
        ? undefined
        : sql`${streams.availability} is distinct from ${MEMBER_ONLY_AVAILABILITY}`,
    ))
    .orderBy(NEWEST_FIRST, transcripts.title)
  return rows.map(toIndexEntry)
}

export function selectTranscriptMetaQuery(db: Db, datasetId: string, videoId: string) {
  return db
    .select()
    .from(transcripts)
    .where(and(eq(transcripts.datasetId, datasetId), eq(transcripts.videoId, videoId)))
    .limit(1)
}

export type TranscriptMetaRow = Awaited<ReturnType<typeof selectTranscriptMetaQuery>>[number]

export function mapTranscriptMeta(row: TranscriptMetaRow | undefined): TranscriptMeta | null {
  return row ? toMeta(row) : null
}

export async function getTranscriptMeta(
  db: Db,
  datasetId: string,
  videoId: string,
): Promise<TranscriptMeta | null> {
  const [row] = await selectTranscriptMetaQuery(db, datasetId, videoId)
  return mapTranscriptMeta(row)
}
