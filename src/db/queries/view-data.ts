import type { Db } from '@/db/connection'
import { aggregateDataset, type DatasetTotals, type StreamRow as AggregateStreamRow } from '@/lib/aggregate'
import { buildGroupDataFromStreams, buildGroupDataFromSummary, type GroupData } from '@/lib/group'
import type { DatasetIndexEntry, StreamSummary } from '@/types/dataset'
import type { StreamDatapack } from '@/types/datapack'
import { getDatasets } from './datasets'
import { getGroupGallery, getGroupSummary } from './group'
import { getDatasetInsights } from './insights'
import { getDatasetPacks, getStreamPack } from './packs'
import { listStreams } from './streams'

export interface DatasetPageData {
  datasets: DatasetIndexEntry[]
  dataset: DatasetIndexEntry
  rows: StreamSummary[]
  totals: DatasetTotals
}

export interface GroupPageData {
  datasets: DatasetIndexEntry[]
  data: GroupData
}

export interface VisibilityOptions {
  /** 默认 `false`：列表、统计与聚合都不含会员限定场次。 */
  includeMemberOnly?: boolean
}

export function toIndex(rows: Awaited<ReturnType<typeof getDatasets>>): DatasetIndexEntry[] {
  return rows.map(row => ({
    id: row.id,
    label: row.label,
    color: row.color,
    avatar: row.avatarKey,
    channelId: row.channelId,
    count: row.streamCount,
    generatedAt: row.generatedAt,
    manifest: `data/${row.id}/manifest.json`,
    insights: `data/${row.id}/insights.json`,
  }))
}

async function resolveTotals(
  db: Db,
  datasetId: string,
  rows: StreamSummary[],
  insightTotals: DatasetTotals | null,
  includeMemberOnly: boolean,
): Promise<DatasetTotals> {
  // insights 的口径包含会员限定场次；公开视图必须按同一过滤条件重算，
  // 否则页头场次数会和列表、图表对不上。
  if (includeMemberOnly && insightTotals) return insightTotals

  const packs = await getDatasetPacks(db, datasetId, { includeMemberOnly })
  const aggregateRows: AggregateStreamRow[] = rows
    .map(summary => {
      const pack = packs.get(summary.videoId)
      return pack ? { summary, pack } : null
    })
    .filter((row): row is AggregateStreamRow => row !== null)

  return aggregateDataset(aggregateRows)
}

export async function getDatasetPageData(
  db: Db,
  datasetId: string,
  options: VisibilityOptions = {},
): Promise<DatasetPageData | null> {
  const includeMemberOnly = options.includeMemberOnly ?? false
  // 三个查询并行发出；Neon HTTP 每个查询一次往返，并行能把等待压到一轮。
  const [all, list, insight] = await Promise.all([
    getDatasets(db, { includeMemberOnly }),
    listStreams(db, datasetId, { limit: 2000, includeMemberOnly }),
    includeMemberOnly ? getDatasetInsights(db, datasetId) : Promise.resolve(null),
  ])

  const datasets = toIndex(all)
  const dataset = datasets.find(item => item.id === datasetId)
  if (!dataset) return null

  const totals = await resolveTotals(
    db,
    datasetId,
    list.streams,
    insight?.totals ?? null,
    includeMemberOnly,
  )

  return {
    datasets,
    dataset,
    rows: list.streams,
    totals,
  }
}

export async function getGroupPageData(
  db: Db,
  view: 'home' | 'gallery',
  options: VisibilityOptions = {},
): Promise<GroupPageData> {
  const includeMemberOnly = options.includeMemberOnly ?? false
  const datasets = toIndex(await getDatasets(db, { includeMemberOnly }))

  if (view === 'gallery') {
    const gallery = await getGroupGallery(db, { includeMemberOnly })
    return { datasets, data: buildGroupDataFromStreams(datasets, gallery.streams) }
  }

  const summary = await getGroupSummary(db, { includeMemberOnly })
  return { datasets, data: buildGroupDataFromSummary(datasets, summary) }
}

export async function getComparePacks(
  db: Db,
  datasetId: string,
  videoIds: string[],
): Promise<Record<string, StreamDatapack>> {
  const entries = await Promise.all(
    videoIds.map(async videoId => {
      const pack = await getStreamPack(db, datasetId, videoId)
      return pack ? ([videoId, pack] as const) : null
    }),
  )
  return Object.fromEntries(
    entries.filter((entry): entry is readonly [string, StreamDatapack] => entry !== null),
  )
}

export { getStreamPack }
