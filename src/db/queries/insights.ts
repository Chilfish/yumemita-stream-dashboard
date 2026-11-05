import { eq } from 'drizzle-orm'
import type { Db } from '@/db/connection'
import { datasetInsights } from '@/db/schema'
import type { DatasetTotals } from '@/lib/aggregate'
import type { DatasetInsightDto } from '@/types/db'
import { toIso } from './shared'

/**
 * 公开页面汇总：只读一行预聚合 JSON。
 * 旧数据没有 `public_totals` 时回退全量口径（会员限定场会多算，重新 ingest 即修复）。
 */
export function selectPublicTotalsQuery(db: Db, datasetId: string) {
  return db
    .select({
      totals: datasetInsights.totals,
      publicTotals: datasetInsights.publicTotals,
    })
    .from(datasetInsights)
    .where(eq(datasetInsights.datasetId, datasetId))
}

export type PublicTotalsRow = Awaited<ReturnType<typeof selectPublicTotalsQuery>>[number]

export function mapPublicTotals(
  datasetId: string,
  row: PublicTotalsRow | undefined,
): DatasetTotals | null {
  if (!row) return null
  if (!row.publicTotals) {
    console.warn(`[db] ${datasetId} 缺少 public_totals，回退 totals；请重新 ingest`)
  }
  return (row.publicTotals ?? row.totals) as DatasetTotals
}

export async function getDatasetPublicTotals(
  db: Db,
  datasetId: string,
): Promise<DatasetTotals | null> {
  const [row] = await selectPublicTotalsQuery(db, datasetId)
  return mapPublicTotals(datasetId, row)
}

export async function getDatasetInsights(
  db: Db,
  datasetId: string,
): Promise<DatasetInsightDto | null> {
  const [row] = await db
    .select()
    .from(datasetInsights)
    .where(eq(datasetInsights.datasetId, datasetId))

  if (!row) return null

  return {
    datasetId: row.datasetId,
    totals: row.totals as DatasetTotals,
    generatedAt: toIso(row.generatedAt),
  }
}
