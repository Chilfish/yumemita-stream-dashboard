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

function toIndex(rows: Awaited<ReturnType<typeof getDatasets>>): DatasetIndexEntry[] {
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
): Promise<DatasetTotals> {
  if (insightTotals) return insightTotals

  // 迁移期兜底：insights 还没 ingest 时，从已入库的场次重算。
  const packs = await getDatasetPacks(db, datasetId)
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
): Promise<DatasetPageData | null> {
  // 三个查询并行发出；Neon HTTP 每个查询一次往返，并行能把等待压到一轮。
  const [all, list, insight] = await Promise.all([
    getDatasets(db),
    listStreams(db, datasetId, { limit: 2000 }),
    getDatasetInsights(db, datasetId),
  ])

  const datasets = toIndex(all)
  const dataset = datasets.find(item => item.id === datasetId)
  if (!dataset) return null

  const totals = await resolveTotals(db, datasetId, list.streams, insight?.totals ?? null)

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
): Promise<GroupPageData> {
  const datasets = toIndex(await getDatasets(db))

  if (view === 'gallery') {
    const gallery = await getGroupGallery(db)
    return { datasets, data: buildGroupDataFromStreams(datasets, gallery.streams) }
  }

  const summary = await getGroupSummary(db)
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
