import type { Db } from '@/db/connection'
import { streams } from '@/db/schema'
import { buildCompareBuckets, type CompareStreamRow } from '@/lib/compare'
import { MIN_COMPARE_SAMPLE } from '@/lib/compare-params'
import type { GroupCompareData } from '@/types/compare'
import type { DatasetIndexEntry } from '@/types/dataset'
import { getDatasets } from './datasets'
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
 * 组级对比是聚合统计，不展示单场正文，因此会员限定场次也计入（与单场 / 逐字稿的可见性分开）。
 */
export async function getGroupCompareData(db: Db): Promise<GroupComparePageData> {
  const [datasetRows, rows] = await Promise.all([
    getDatasets(db),
    db
      .select({
        datasetId: streams.datasetId,
        title: streams.title,
        date: streams.date,
        startedAt: streams.startedAt,
        durationSec: streams.durationSec,
        avgConcurrent: streams.avgConcurrent,
        chatTotal: streams.chatTotal,
        superchats: streams.superchats,
        commentsCaptured: streams.commentsCaptured,
      })
      .from(streams),
  ])

  const leanRows: CompareStreamRow[] = rows.map(row => ({
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
    datasets: toIndex(datasetRows),
    data: { buckets, months, sampleMin: MIN_COMPARE_SAMPLE },
  }
}
