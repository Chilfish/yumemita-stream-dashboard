import { eq, sql } from 'drizzle-orm'
import type { Db } from '@/db/connection'
import { datasets, streams } from '@/db/schema'
import type { DatasetSummary } from '@/types/db'
import { toIso } from './shared'

/**
 * 成员的场次数按 owner ∪ 参与者统计，与场次列表、成员页呈同一口径。
 * 全组总数不要用这些数字相加：联动场会同时计入两位成员。
 */
const STREAMS_TABLE = sql`(select dataset_id, participants, source_generated_at from streams) s`

export function selectDatasetsQuery(db: Db, datasetId: string | undefined) {
  const memberWhere = sql`s.dataset_id = ${datasets.id} or ${datasets.id}::text = any(s.participants)`
  const memberStreams = sql<number>`(select count(*)::int from ${STREAMS_TABLE} where ${memberWhere})`
  const memberGeneratedAt = sql<Date | null>`(select max(s.source_generated_at) from ${STREAMS_TABLE} where ${memberWhere})`

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
      streamCount: memberStreams,
      generatedAt: memberGeneratedAt,
    })
    .from(datasets)
    .where(datasetId ? eq(datasets.id, datasetId) : undefined)
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
