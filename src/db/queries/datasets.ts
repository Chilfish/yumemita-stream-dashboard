import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '@/db/connection'
import { datasets, streams } from '@/db/schema'
import type { DatasetSummary } from '@/types/db'
import { toIso } from './shared'

/**
 * 成员的场次数按 owner ∪ 参与者统计，与场次列表、成员页呈同一口径。
 * 全组总数不要用这些数字相加：联动场会同时计入两位成员。
 *
 * `participants` 只在**成员频道**的场次里代表「来串门的其他成员」；
 * 官方账号场次的 `participants` 含义是「在场的成员」，不能反推给成员页，
 * 所以子查询要带出 owner 的 kind，成员条件再加一道 owner 是成员的前提。
 */
const STREAMS_TABLE = sql`(
  select s.dataset_id, s.participants, s.source_generated_at, d.kind as owner_kind
    from streams s
    join datasets d on d.id = s.dataset_id
) s`

export function selectDatasetsQuery(
  db: Db,
  datasetId: string | undefined,
  options: { kind?: 'member' | 'official' } = {},
) {
  const memberWhere = sql`s.dataset_id = ${datasets.id}
    or (s.owner_kind = 'member' and ${datasets.id}::text = any(s.participants))`
  const memberStreams = sql<number>`(select count(*)::int from ${STREAMS_TABLE} where ${memberWhere})`
  const memberGeneratedAt = sql<Date | null>`(select max(s.source_generated_at) from ${STREAMS_TABLE} where ${memberWhere})`

  const where = and(
    datasetId ? eq(datasets.id, datasetId) : undefined,
    options.kind ? eq(datasets.kind, options.kind) : undefined,
  )

  return db
    .select({
      id: datasets.id,
      label: datasets.label,
      kind: datasets.kind,
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
    .where(where)
    // 成员在前、官方账号在后，同组内按 id。只按 id 排会把官方账号夹在成员之间。
    .orderBy(sql`case when ${datasets.kind} = 'member' then 0 else 1 end`, datasets.id)
}

/** 成员列表：组级口径、对比默认集合、SEO 人数都只数成员。 */
export function selectMembersQuery(db: Db) {
  return selectDatasetsQuery(db, undefined, { kind: 'member' })
}

export type DatasetQueryRow = Awaited<ReturnType<typeof selectDatasetsQuery>>[number]

export function mapDataset(row: DatasetQueryRow): DatasetSummary {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
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

/** 只取成员（`kind='member'`），不含官方账号。 */
export async function getMembers(db: Db): Promise<DatasetSummary[]> {
  const rows = await selectMembersQuery(db)
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
