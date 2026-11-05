import { eq, sql } from 'drizzle-orm'
import type { Db } from '@/db/connection'
import { datasets, streams } from '@/db/schema'
import type { DatasetSummary } from '@/types/db'
import { toIso } from './shared'

export function selectDatasetsQuery(db: Db, datasetId: string | undefined) {
  const joinCondition = eq(streams.datasetId, datasets.id)

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
    .leftJoin(streams, joinCondition)
    .where(datasetId ? eq(datasets.id, datasetId) : undefined)
    .groupBy(datasets.id)
    .orderBy(datasets.id)
}

export type DatasetQueryRow = Awaited<ReturnType<typeof selectDatasetsQuery>>[number]

export function mapDataset(row: DatasetQueryRow): DatasetSummary {
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
  const rows = await selectDatasetsQuery(db, undefined)
  return rows.map(mapDataset)
}

export async function getDataset(
  db: Db,
  datasetId: string,
): Promise<DatasetSummary | null> {
  const rows = await selectDatasetsQuery(db, datasetId)
  const row = rows[0]
  return row ? mapDataset(row) : null
}
