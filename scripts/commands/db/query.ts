import process from 'node:process'
import { createDb } from '../src/db/connection.ts'
import {
  getAdminScheduleList,
  getCalendarData,
  getDayPlan,
} from '../src/db/queries/calendar.ts'
import { getDatasets, getDataset } from '../src/db/queries/datasets.ts'
import { getGroupCompareData } from '../src/db/queries/group-compare.ts'
import { getGroupGallery, getGroupSummary } from '../src/db/queries/group.ts'
import { getDatasetInsights } from '../src/db/queries/insights.ts'
import {
  getLatestStream,
  listStreams,
} from '../src/db/queries/streams.ts'
import { getTranscriptIndex, getTranscriptMeta } from '../src/db/queries/transcripts.ts'
import { getCompareDensityMap } from '../src/db/queries/view-data.ts'
import {
  addDays,
  calendarWindow,
  currentJstDay,
  currentJstMonth,
  monthRange,
} from '../src/lib/calendar.ts'
import { loadEnvFiles, requireEnv } from './lib/env.ts'

const failures: string[] = []

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message)
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)
  return sorted[Math.max(0, index)] ?? 0
}

async function main(): Promise<void> {
  loadEnvFiles()
  const db = createDb(requireEnv('DATABASE_URL'))

  const datasets = await getDatasets(db)
  check(datasets.length > 0, '没有 dataset')
  const nonoka = await getDataset(db, 'nonoka')
  check(Boolean(nonoka), '缺少 nonoka dataset')
  check((nonoka?.streamCount ?? 0) > 0, 'nonoka 没有场次')

  const list = await listStreams(db, 'nonoka', { limit: 500 })
  check(list.total === nonoka?.streamCount, 'listStreams.total 与 dataset.streamCount 不一致')
  check(list.streams.length === Math.min(list.total, 500), 'listStreams 行数与 total 不一致')
  for (let index = 1; index < list.streams.length; index += 1) {
    const previous = list.streams[index - 1]?.startedAt ?? ''
    const current = list.streams[index]?.startedAt ?? ''
    check(previous >= current, `listStreams 未按开播时间倒序: ${previous} < ${current}`)
    if (failures.length > 5) break
  }

  const latest = await getLatestStream(db, 'nonoka')
  check(latest?.videoId === list.streams[0]?.videoId, 'getLatestStream 与列表首行不一致')

  const now = new Date()
  const month = currentJstMonth(now)
  const calendarWindowRange = calendarWindow(month, 1, 1)
  const calendar = await getCalendarData(db, {
    from: `${calendarWindowRange.start}-01`,
    to: monthRange(calendarWindowRange.end).to,
    window: calendarWindowRange,
    datasetId: 'nonoka',
    now,
  })
  check(calendar.members.length === datasets.length, 'calendar 成员数与 datasets 不一致')
  check(
    calendar.events.every(event => event.datasetId === 'nonoka'),
    'calendar 混入了其他成员',
  )
  check(
    calendar.events.every(event => event.at === null || Number.isFinite(Date.parse(event.at))),
    'calendar 事件时间不是合法 ISO',
  )
  const calendarStates = calendar.events.reduce<Record<string, number>>((counts, event) => {
    counts[event.state] = (counts[event.state] ?? 0) + 1
    return counts
  }, {})

  const today = currentJstDay(now)
  const dayPlan = await getDayPlan(db, now)
  check(dayPlan.days.length === 2, 'getDayPlan 没有返回今天与明天')
  check(dayPlan.days[0]?.date === today, 'getDayPlan 第一天不是今天')
  check(
    dayPlan.days.every(day => day.events.every(event => event.date === day.date)),
    'getDayPlan 事件混入了其他日期',
  )

  const adminSchedule = await getAdminScheduleList(db, {
    from: addDays(today, -7),
    to: addDays(today, 60),
  })
  check(Array.isArray(adminSchedule), 'getAdminScheduleList 没有返回数组')
  check(
    adminSchedule.every(item => item.date === null || /^\d{4}-\d{2}-\d{2}$/.test(item.date)),
    '管理日程日期格式异常',
  )

  const insights = await getDatasetInsights(db, 'nonoka')
  check(insights === null || insights.totals.streamCount > 0, 'dataset_insights 数据异常')

  const transcriptEntries = await getTranscriptIndex(db, 'nonoka')
  for (let index = 1; index < transcriptEntries.length; index += 1) {
    const previous = transcriptEntries[index - 1]?.date ?? ''
    const current = transcriptEntries[index]?.date ?? ''
    check(previous >= current, `getTranscriptIndex 未按日期倒序: ${previous} < ${current}`)
    if (failures.length > 5) break
  }
  if (transcriptEntries[0]) {
    const meta = await getTranscriptMeta(db, 'nonoka', transcriptEntries[0].videoId)
    check(Boolean(meta?.r2Key), 'getTranscriptMeta 缺少 r2Key')
  }

  const summary = await getGroupSummary(db)
  check(summary.members.length > 0, 'group summary 没有成员')
  check(summary.recent.length > 0, 'group summary 没有 recent')
  const gallery = await getGroupGallery(db)
  check(gallery.streams.length > 0, 'group gallery 没有场次')

  const compare = await getGroupCompareData(db)
  check(compare.datasets.length > 0, 'group compare 没有成员')
  check(compare.data.buckets.length > 0, 'group compare 没有聚合桶')
  check(compare.data.months.length > 0, 'group compare 没有月份')
  check(
    compare.data.months.every((month, index) => index === 0 || month > compare.data.months[index - 1]),
    'group compare 月份未升序',
  )
  const compareIds = new Set(compare.datasets.map(dataset => dataset.id))
  check(
    compare.data.buckets.every(bucket => compareIds.has(bucket.memberId)),
    'group compare 桶里有未知成员',
  )
  check(
    compare.data.buckets
      .filter(bucket => bucket.type === 'all')
      .every(bucket => bucket.streams > 0),
    'group compare 桶的场次数异常',
  )

  const densityIds = list.streams.slice(0, 3).map(row => row.videoId)
  const densities = await getCompareDensityMap(db, 'nonoka', densityIds)
  check(
    densityIds.every(videoId => Array.isArray(densities[videoId])),
    'getCompareDensityMap 缺少所选场次的密度数组',
  )

  const timings: number[] = []
  for (let index = 0; index < 20; index += 1) {
    const started = performance.now()
    await Promise.all([
      listStreams(db, 'nonoka', { limit: 500 }),
      getDatasetInsights(db, 'nonoka'),
    ])
    timings.push(performance.now() - started)
  }

  console.log(JSON.stringify({
    datasets: datasets.map(item => ({ id: item.id, streams: item.streamCount })),
    nonoka: {
      total: list.total,
      latest: latest?.videoId ?? null,
      insights: insights ? insights.totals.streamCount : null,
      transcripts: transcriptEntries.length,
      calendar: { events: calendar.events.length, states: calendarStates },
      dayPlan: dayPlan.days.map(day => day.events.length),
      adminSchedule: adminSchedule.length,
    },
    group: {
      members: summary.members.length,
      days: summary.days.length,
      latest: summary.latest.length,
      recent: summary.recent.length,
      gallery: gallery.streams.length,
      compareBuckets: compare.data.buckets.length,
      compareMonths: compare.data.months.length,
    },
    listAndInsightsMs: {
      p50: Number(percentile(timings, 0.5).toFixed(1)),
      p95: Number(percentile(timings, 0.95).toFixed(1)),
    },
    failures,
  }, null, 2))

  if (failures.length > 0) process.exitCode = 1
}

await main()
