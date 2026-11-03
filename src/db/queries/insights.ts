import { eq } from 'drizzle-orm'
import type { Db } from '@/db/connection'
import { datasetInsights } from '@/db/schema'
import type { DatasetTotals } from '@/lib/aggregate'
import type { DatasetInsightDto } from '@/types/db'
import { toIso } from './shared'

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
