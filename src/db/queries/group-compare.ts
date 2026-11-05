import { runBatch } from '@/db/batch'
import type { Db } from '@/db/connection'
import { streams } from '@/db/schema'
import { buildCompareBuckets, type CompareStreamRow } from '@/lib/compare'
import { MIN_COMPARE_SAMPLE } from '@/lib/compare-params'
import { isMemberOnly } from '@/lib/visibility'
import type { GroupCompareData } from '@/types/compare'
import type { DatasetIndexEntry } from '@/types/dataset'
import { mapDataset, selectDatasetsQuery, type DatasetQueryRow } from './datasets'
import { toIso, toNumber } from './shared'
import { toIndex } from './view-data'

export interface GroupComparePageData {
  datasets: DatasetIndexEntry[]
  data: GroupCompareData
}

/**
 * 组级对比只读 8 个精简列，再按「成员 × 月份 × 内容类型」预聚合。
 *
 * 这里刻意不用 SQL 聚合：内容类型来自 `classify.ts` 的标题规则，数据库没有这一列。
 * 当前规模约 1900 行 × 8 列，页面缓存 300s；数据量明显增长后再把数值聚合下推到 SQL。
 *
 * 组级对比是纯指标聚合，会员限定场的指标不公开，
 * 因此只把公开场次送进桶子；场次/日期类统计仍由首页与相册负责。
 */
export async function getGroupCompareData(db: Db): Promise<GroupComparePageData> {
  const rowsQuery = db
    .select({
      datasetId: streams.datasetId,
      availability: streams.availability,
      title: streams.title,
      date: streams.date,
      startedAt: streams.startedAt,
      durationSec: streams.durationSec,
      avgConcurrent: streams.avgConcurrent,
      chatTotal: streams.chatTotal,
      superchats: streams.superchats,
      commentsCaptured: streams.commentsCaptured,
    })
    .from(streams)

  const [datasetRows, rows] = await runBatch<[
    DatasetQueryRow[],
    Awaited<typeof rowsQuery>,
  ]>(db, [
    selectDatasetsQuery(db, undefined),
    rowsQuery,
  ])

  const leanRows: CompareStreamRow[] = rows
    .filter(row => !isMemberOnly(row.availability))
    .map(row => ({
      datasetId: row.datasetId,
      title: row.title,
      date: row.date ?? null,
      startedAt: toIso(row.startedAt),
      durationSec: row.durationSec,
      avgConcurrent: toNumber(row.avgConcurrent),
      chatTotal: row.chatTotal ?? 0,
      superchats: row.superchats ?? 0,
      commentsCaptured: row.commentsCaptured,
    }))

  const buckets = buildCompareBuckets(leanRows)
  const months = [...new Set(buckets.filter(bucket => bucket.type === 'all').map(bucket => bucket.month))]
    .sort((left, right) => left.localeCompare(right))

  return {
    datasets: toIndex(datasetRows.map(mapDataset)),
    data: { buckets, months, sampleMin: MIN_COMPARE_SAMPLE },
  }
}
