import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '@/db/connection'
import { transcripts } from '@/db/schema'
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
): Promise<TranscriptIndexEntry[]> {
  const rows = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.datasetId, datasetId))
    .orderBy(NEWEST_FIRST, transcripts.title)
  return rows.map(toIndexEntry)
}

export async function getTranscriptMeta(
  db: Db,
  datasetId: string,
  videoId: string,
): Promise<TranscriptMeta | null> {
  const [row] = await db
    .select()
    .from(transcripts)
    .where(and(eq(transcripts.datasetId, datasetId), eq(transcripts.videoId, videoId)))
    .limit(1)
  return row ? toMeta(row) : null
}
