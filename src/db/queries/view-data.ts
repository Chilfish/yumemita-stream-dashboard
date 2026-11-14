import { runBatch } from '@/db/batch'
import type { Db } from '@/db/connection'
import type { DatasetTotals } from '@/lib/aggregate'
import { buildGroupDataFromStreams, buildGroupDataFromSummary, type GroupData } from '@/lib/group'
import { toCollaborationStream, type CollaborationStream } from '@/lib/collaboration'
import { addDays, currentJstDay } from '@/lib/calendar'
import type { CalendarMember, DayPlan } from '@/types/calendar'
import type { DatasetIndexEntry, StreamNavItem, StreamSummary } from '@/types/dataset'
import type { StreamDatapack } from '@/types/datapack'
import type { GroupStreamSummary } from '@/types/group'
import {
  buildScheduleQueries,
  buildStreamQueries,
  buildDayPlanFromRows,
  type ScheduleQueryRow as CalendarScheduleRow,
  type StreamQueryRow as CalendarStreamRow,
} from './calendar'
import {
  getDatasets,
  mapDataset,
  selectDatasetsQuery,
  type DatasetQueryRow,
} from './datasets'
import {
  assembleGroupSummary,
  buildCollaborationStreamsQuery,
  buildGroupGalleryQuery,
  buildGroupSummaryQueries,
  buildOnThisDayQuery,
  mapGroupStreams,
  type GroupSummaryParts,
} from './group'
import { mapPublicTotals, selectPublicTotalsQuery, type PublicTotalsRow } from './insights'
import {
  assembleStreamPack,
  buildStreamPackQueries,
  getCompareDensities,
  getStreamPacks,
  type CompareDensityMap,
  type StreamPackParts,
} from './packs'
import {
  buildStreamListQuery,
  buildStreamNavQuery,
  buildStreamSummariesQuery,
  mapStreamList,
  mapStreamRow,
  selectStreamQuery,
  type StreamListRow,
  type StreamQueryRow,
} from './streams'
import { toIso } from './shared'
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
  /** 组首页联动关系视图的场次；相册等页面为空数组。 */
  collaborations: CollaborationStream[]
  /** 组首页的今天 / 明天计划；其他页面为 null。 */
  dayPlan: DayPlan | null
  /** JST 今天的完整日期 `YYYY-MM-DD`，相册据此排除今天的场次。 */
  today: string
  /** JST 今天的月和日 `MM-DD`，用作「那年今日」的默认筛选。 */
  todayMonthDay: string
  /** 组首页「那年今日」的往期场次；其他页面为空数组。 */
  onThisDay: GroupStreamSummary[]
}

function mapCollaborations(
  rows: Awaited<ReturnType<typeof buildCollaborationStreamsQuery>>,
): CollaborationStream[] {
  return rows
    .map(row =>
      toCollaborationStream({
        videoId: row.videoId,
        datasetId: row.datasetId,
        participants: row.participants ?? [],
        date: row.date ?? '',
        title: row.title,
      }),
    )
    .filter((row): row is CollaborationStream => row !== null)
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

export interface StreamPageData {
  datasets: DatasetIndexEntry[]
  dataset: DatasetIndexEntry
  totals: DatasetTotals | null
  summary: StreamSummary
  /** `[较新, 较早]` 的 videoId；邻场摘要与 pack 放在第二轮同一批查询。 */
  neighborIds: [string | null, string | null]
  /** 标题级索引，供命令面板、键盘导航与场次数使用。 */
  navItems: StreamNavItem[]
}

/**
 * 单场页：不再为 1 行 summary 拉回整成员的 34 列摘要。
 * 第一轮取成员、导航索引、当前场次与汇总；第二轮只补邻场摘要（最多 2 行）。
 */
export async function getStreamPageData(
  db: Db,
  datasetId: string,
  videoId: string,
): Promise<StreamPageData | null> {
  const [datasetRows, navRows, summaryRows, totalsRows] = await runBatch<[
    DatasetQueryRow[],
    Awaited<ReturnType<typeof buildStreamNavQuery>>,
    StreamQueryRow[],
    PublicTotalsRow[],
  ]>(db, [
    selectDatasetsQuery(db, undefined),
    buildStreamNavQuery(db, datasetId),
    selectStreamQuery(db, datasetId, videoId),
    selectPublicTotalsQuery(db, datasetId),
  ])

  const datasets = toIndex(datasetRows.map(mapDataset))
  const dataset = datasets.find(item => item.id === datasetId)
  const summaryRow = summaryRows[0]
  if (!dataset || !summaryRow) return null

  const summary = mapStreamRow(summaryRow)
  const navItems: StreamNavItem[] = navRows.map(row => ({
    videoId: row.videoId,
    title: row.title,
    date: row.date ?? '',
    startedAt: toIso(row.startedAt),
    durationSec: row.durationSec,
  }))

  const index = navItems.findIndex(item => item.videoId === videoId)
  const neighborIds: [string | null, string | null] = [
    index > 0 ? navItems[index - 1]?.videoId ?? null : null,
    index >= 0 && index < navItems.length - 1 ? navItems[index + 1]?.videoId ?? null : null,
  ]

  return {
    datasets,
    dataset,
    totals: mapPublicTotals(datasetId, totalsRows[0]),
    summary,
    neighborIds,
    navItems,
  }
}

export async function getGroupPageData(
  db: Db,
  view: 'home' | 'gallery',
  options: { withToday?: boolean } = {},
): Promise<GroupPageData> {
  const now = new Date()
  const today = currentJstDay(now)
  const todayMonthDay = today.slice(5)
  const tomorrow = addDays(today, 1)

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
      collaborations: [],
      dayPlan: null,
      today,
      todayMonthDay,
      onThisDay: [],
    }
  }

  if (!options.withToday) {
    const [datasetRows, members, days, latest, recent, participantRows, collaborationRows] = await runBatch<
      [DatasetQueryRow[], ...GroupSummaryParts, Awaited<ReturnType<typeof buildCollaborationStreamsQuery>>]
    >(db, [
      selectDatasetsQuery(db, undefined),
      ...buildGroupSummaryQueries(db),
      buildCollaborationStreamsQuery(db),
    ])
    const datasets = toIndex(datasetRows.map(mapDataset))
    return {
      datasets,
      data: buildGroupDataFromSummary(
        datasets,
        assembleGroupSummary(members, days, latest, recent, participantRows),
      ),
      collaborations: mapCollaborations(collaborationRows),
      dayPlan: null,
      today,
      todayMonthDay,
      onThisDay: [],
    }
  }

  const [
    datasetRows,
    members,
    days,
    latest,
    recent,
    participantRows,
    collaborationRows,
    todayStreams,
    todaySchedules,
    onThisDayRows,
  ] = await runBatch<
    [
      DatasetQueryRow[],
      ...GroupSummaryParts,
      Awaited<ReturnType<typeof buildCollaborationStreamsQuery>>,
      CalendarStreamRow[],
      CalendarScheduleRow[],
      Awaited<ReturnType<typeof buildOnThisDayQuery>>,
    ]
  >(db, [
    selectDatasetsQuery(db, undefined),
    ...buildGroupSummaryQueries(db),
    buildCollaborationStreamsQuery(db),
    buildStreamQueries(db, { from: today, to: tomorrow }),
    buildScheduleQueries(db, { from: today, to: tomorrow }),
    buildOnThisDayQuery(db, todayMonthDay, today),
  ])
  const datasets = toIndex(datasetRows.map(mapDataset))
  const summary = assembleGroupSummary(members, days, latest, recent, participantRows)
  const calendarMembers: CalendarMember[] = datasets.map(dataset => ({
    id: dataset.id,
    label: dataset.label,
    color: dataset.color ?? null,
    avatar: dataset.avatar ?? null,
    streamCount: dataset.count,
  }))

  return {
    datasets,
    data: buildGroupDataFromSummary(datasets, summary),
    collaborations: mapCollaborations(collaborationRows),
    dayPlan: buildDayPlanFromRows(todayStreams, todaySchedules, calendarMembers, now, 2),
    today,
    todayMonthDay,
    onThisDay: mapGroupStreams(onThisDayRows),
  }
}

export async function getComparePacks(
  db: Db,
  datasetId: string,
  videoIds: string[],
): Promise<Record<string, StreamDatapack>> {
  return Object.fromEntries(await getStreamPacks(db, datasetId, videoIds))
}

/** 对比页首屏只需要逐分钟密度；整份 pack 留给 API 与单场页。 */
export function getCompareDensityMap(
  db: Db,
  datasetId: string,
  videoIds: string[],
  options: { includeMemberOnly?: boolean } = {},
): Promise<CompareDensityMap> {
  return getCompareDensities(db, datasetId, videoIds, options)
}

/** 单场正文的第二轮查询：逐字稿元数据 + pack，放在同一个 batch。 */
export async function getStreamPageExtras(
  db: Db,
  datasetId: string,
  videoId: string,
  neighborIds: (string | null)[] = [],
): Promise<{
  transcript: TranscriptMeta | null
  pack: StreamDatapack | null
  neighbors: StreamSummary[]
}> {
  const ids = neighborIds.filter((id): id is string => Boolean(id))
  const neighborQuery = ids.length > 0 ? buildStreamSummariesQuery(db, datasetId, ids) : null

  if (!neighborQuery) {
    const [transcriptRows, ...parts] = await runBatch<[TranscriptMetaRow[], ...StreamPackParts]>(db, [
      selectTranscriptMetaQuery(db, datasetId, videoId),
      ...buildStreamPackQueries(db, datasetId, videoId, { words: 40, authors: 20 }),
    ])
    return {
      transcript: mapTranscriptMeta(transcriptRows[0]),
      pack: assembleStreamPack(parts),
      neighbors: [],
    }
  }

  const [transcriptRows, neighborRows, ...parts] = await runBatch<[
    TranscriptMetaRow[],
    Awaited<ReturnType<typeof buildStreamSummariesQuery>>,
    ...StreamPackParts,
  ]>(db, [
    selectTranscriptMetaQuery(db, datasetId, videoId),
    neighborQuery,
    ...buildStreamPackQueries(db, datasetId, videoId, { words: 40, authors: 20 }),
  ])

  return {
    transcript: mapTranscriptMeta(transcriptRows[0]),
    pack: assembleStreamPack(parts),
    neighbors: neighborRows.map(row => mapStreamRow(row)),
  }
}
