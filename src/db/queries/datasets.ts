import { eq, sql } from 'drizzle-orm'
import type { Db } from '@/db/connection'
import { datasets, streams } from '@/db/schema'
import type { DatasetSummary } from '@/types/db'
import { toIso } from './shared'

async function selectDatasets(db: Db, datasetId?: string) {
  return db
    .select({
      id: datasets.id,
      label: datasets.label,
      color: datasets.color,
      avatarKey: datasets.avatarKey,
      channelId: datasets.channelId,
      subject: datasets.subject,
      scope: datasets.scope,
      note: datasets.note,
      streamCount: sql<number>`count(${streams.id})::int`,
      generatedAt: sql<Date | null>`max(${streams.sourceGeneratedAt})`,
    })
    .from(datasets)
    .leftJoin(streams, eq(streams.datasetId, datasets.id))
    .where(datasetId ? eq(datasets.id, datasetId) : undefined)
    .groupBy(datasets.id)
    .orderBy(datasets.id)
}

function mapDataset(row: Awaited<ReturnType<typeof selectDatasets>>[number]): DatasetSummary {
  return {
    id: row.id,
    label: row.label,
    color: row.color,
    avatarKey: row.avatarKey,
    channelId: row.channelId,
    subject: row.subject,
    scope: row.scope,
    note: row.note,
    streamCount: row.streamCount,
    generatedAt: toIso(row.generatedAt),
  }
}

export async function getDatasets(db: Db): Promise<DatasetSummary[]> {
  const rows = await selectDatasets(db)
  return rows.map(mapDataset)
}

export async function getDataset(db: Db, datasetId: string): Promise<DatasetSummary | null> {
  const rows = await selectDatasets(db, datasetId)
  const row = rows[0]
  return row ? mapDataset(row) : null
}
