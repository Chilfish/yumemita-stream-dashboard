import type { Db } from '@/db/connection'
import { aggregateDataset, type DatasetTotals, type StreamRow } from '@/lib/aggregate'
import { getDatasetPacks } from './packs'
import { listStreams } from './streams'

/**
 * 按数据库当前状态重算公开口径汇总。
 *
 * 只在 `db:ingest` 里调用：它会读整份明细（数量级 10 MB / dataset），
 * 结果写进 `dataset_insights.public_totals`，请求期不再重复这一步。
 */
export async function computeDatasetPublicTotals(
  db: Db,
  datasetId: string,
): Promise<DatasetTotals> {
  const [list, packs] = await Promise.all([
    listStreams(db, datasetId, { limit: 2000 }),
    getDatasetPacks(db, datasetId),
  ])

  const rows: StreamRow[] = list.streams
    .map(summary => {
      const pack = packs.get(summary.videoId)
      return pack ? { summary, pack } : null
    })
    .filter((row): row is StreamRow => row !== null)

  return aggregateDataset(rows)
}
