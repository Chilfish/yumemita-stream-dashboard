import type { Db } from '@/db/connection'
import { aggregateDataset, type DatasetTotals, type StreamRow } from '@/lib/aggregate'
import { getDatasetPacks } from './packs'
import { listStreams } from './streams'

const PAGE_SIZE = 2000

/** 汇总需要该 dataset 的全部场次；超过单页上限时继续翻页，避免静默截断。 */
async function listAllStreams(db: Db, datasetId: string) {
  const streams = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await listStreams(db, datasetId, {
      limit: PAGE_SIZE,
      offset,
      withTotal: false,
    })
    streams.push(...page.streams)
    if (page.streams.length < PAGE_SIZE) break
  }
  return streams
}

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
  const [summaries, packs] = await Promise.all([
    listAllStreams(db, datasetId),
    getDatasetPacks(db, datasetId),
  ])

  const rows: StreamRow[] = summaries
    .map(summary => {
      const pack = packs.get(summary.videoId)
      return pack ? { summary, pack } : null
    })
    .filter((row): row is StreamRow => row !== null)

  return aggregateDataset(rows)
}
