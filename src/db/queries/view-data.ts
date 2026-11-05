import { runBatch } from '@/db/batch'
import type { Db } from '@/db/connection'
import type { DatasetTotals } from '@/lib/aggregate'
import { buildGroupDataFromStreams, buildGroupDataFromSummary, type GroupData } from '@/lib/group'
import type { DatasetIndexEntry, StreamSummary } from '@/types/dataset'
import type { StreamDatapack } from '@/types/datapack'
import {
  getDatasets,
  mapDataset,
  selectDatasetsQuery,
  type DatasetQueryRow,
} from './datasets'
import {
  assembleGroupSummary,
  buildGroupGalleryQuery,
  buildGroupSummaryQueries,
  mapGroupStreams,
  type GroupSummaryParts,
} from './group'
import { mapPublicTotals, selectPublicTotalsQuery, type PublicTotalsRow } from './insights'
import {
  assembleStreamPack,
  buildStreamPackQueries,
  getStreamPacks,
  type StreamPackParts,
} from './packs'
import { buildStreamListQuery, mapStreamList, type StreamListRow } from './streams'
import {
  mapTranscriptMeta,
  selectTranscriptMetaQuery,
  type TranscriptMeta,
  type TranscriptMetaRow,
} from './transcripts'

export interface DatasetPageData {
  datasets: DatasetIndexEntry[]
  dataset: DatasetIndexEntry
  rows: StreamSummary[]
  totals: DatasetTotals | null
}

export interface GroupPageData {
  datasets: DatasetIndexEntry[]
  data: GroupData
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

export async function getDatasetPageData(
  db: Db,
  datasetId: string,
): Promise<DatasetPageData | null> {
  // 三条查询互不依赖，放进同一个 Neon HTTP batch（本地 pg 回退并行）。
  const [datasetRows, listRows, totalsRows] = await runBatch<
    [DatasetQueryRow[], StreamListRow[], PublicTotalsRow[]]
  >(db, [
    selectDatasetsQuery(db, undefined),
    buildStreamListQuery(db, datasetId, { limit: 2000, withTotal: false }),
    selectPublicTotalsQuery(db, datasetId),
  ])

  const datasets = toIndex(datasetRows.map(mapDataset))
  const dataset = datasets.find(item => item.id === datasetId)
  if (!dataset) return null

  return {
    datasets,
    dataset,
    rows: mapStreamList(listRows).streams,
    // 汇总由 db:ingest 预聚合，请求期只读一行 JSON；不要再加载整份明细。
    totals: mapPublicTotals(datasetId, totalsRows[0]),
  }
}

export async function getGroupPageData(
  db: Db,
  view: 'home' | 'gallery',
): Promise<GroupPageData> {
  if (view === 'gallery') {
    const [datasetRows, streamRows] = await runBatch<[
      DatasetQueryRow[],
      Awaited<ReturnType<typeof buildGroupGalleryQuery>>,
    ]>(db, [
      selectDatasetsQuery(db, undefined),
      buildGroupGalleryQuery(db),
    ])
    const datasets = toIndex(datasetRows.map(mapDataset))
    return {
      datasets,
      data: buildGroupDataFromStreams(datasets, mapGroupStreams(streamRows)),
    }
  }

  const [datasetRows, members, days, latest, recent] = await runBatch<
    [DatasetQueryRow[], ...GroupSummaryParts]
  >(db, [
    selectDatasetsQuery(db, undefined),
    ...buildGroupSummaryQueries(db),
  ])
  const datasets = toIndex(datasetRows.map(mapDataset))
  const summary = assembleGroupSummary(members, days, latest, recent)
  return { datasets, data: buildGroupDataFromSummary(datasets, summary) }
}

export async function getComparePacks(
  db: Db,
  datasetId: string,
  videoIds: string[],
): Promise<Record<string, StreamDatapack>> {
  return Object.fromEntries(await getStreamPacks(db, datasetId, videoIds))
}

/** 单场正文的第二轮查询：逐字稿元数据 + pack，放在同一个 batch。 */
export async function getStreamPageExtras(
  db: Db,
  datasetId: string,
  videoId: string,
): Promise<{ transcript: TranscriptMeta | null, pack: StreamDatapack | null }> {
  const [transcriptRows, ...parts] = await runBatch<[TranscriptMetaRow[], ...StreamPackParts]>(db, [
    selectTranscriptMetaQuery(db, datasetId, videoId),
    ...buildStreamPackQueries(db, datasetId, videoId, { words: 40, authors: 20 }),
  ])

  return {
    transcript: mapTranscriptMeta(transcriptRows[0]),
    pack: assembleStreamPack(parts),
  }
}
