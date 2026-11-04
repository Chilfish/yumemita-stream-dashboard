import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '@/db/connection'
import { datasets, streams } from '@/db/schema'
import { MEMBER_ONLY_AVAILABILITY } from '@/lib/visibility'
import type { DatasetSummary } from '@/types/db'
import { toIso } from './shared'

interface DatasetQueryOptions {
  /** 默认 `false`：场次数只统计公开场次。 */
  includeMemberOnly?: boolean
}

async function selectDatasets(
  db: Db,
  datasetId: string | undefined,
  options: DatasetQueryOptions,
) {
  const joinCondition = and(
    eq(streams.datasetId, datasets.id),
    options.includeMemberOnly
      ? undefined
      : sql`${streams.availability} is distinct from ${MEMBER_ONLY_AVAILABILITY}`,
  )

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

export async function getDatasets(
  db: Db,
  options: DatasetQueryOptions = {},
): Promise<DatasetSummary[]> {
  const rows = await selectDatasets(db, undefined, options)
  return rows.map(mapDataset)
}

export async function getDataset(
  db: Db,
  datasetId: string,
  options: DatasetQueryOptions = {},
): Promise<DatasetSummary | null> {
  const rows = await selectDatasets(db, datasetId, options)
  const row = rows[0]
  return row ? mapDataset(row) : null
}
