/**
 * 查询层冒烟：把页面用到的查询都跑一遍并做基本断言，顺带量一次本地延迟。
 *
 * 不是单元测试，而是「数据库里真的有数据、查询真的按契约返回」的连通性检查；
 * CI / 部署前跑一次，能在页面渲染前发现空库、排序错、跨成员串数据。
 */
import { type CommandSpec, requireEnvVar, type Logger } from '@chilfish/devkit/cli'
import { createDb } from '@/db/connection.ts'
import {
  getAdminScheduleList,
  getCalendarData,
  getDayPlan,
} from '@/db/queries/calendar.ts'
import { getDatasets, getDataset } from '@/db/queries/datasets.ts'
import { getGroupCompareData } from '@/db/queries/group-compare.ts'
import { getGroupGallery, getGroupSummary } from '@/db/queries/group.ts'
import { getDatasetInsights } from '@/db/queries/insights.ts'
import {
  getLatestStream,
  listStreams,
} from '@/db/queries/streams.ts'
import { getTranscriptIndex, getTranscriptMeta } from '@/db/queries/transcripts.ts'
import { getCompareDensityMap } from '@/db/queries/view-data.ts'
import {
  addDays,
  calendarWindow,
  currentJstDay,
  currentJstMonth,
  monthRange,
} from '@/lib/calendar.ts'
import { isMemberOnly } from '@/lib/visibility.ts'

/** 只取命令需要的日志通道；默认空操作。 */
export type QueryLog = Pick<Logger, 'info' | 'warn' | 'error' | 'line'>

const NOOP_LOG: QueryLog = { info: () => {}, warn: () => {}, error: () => {}, line: () => {} }

export interface QuerySmokeOptions {
  /** 延迟采样轮数，默认 20。 */
  rounds?: number
  log?: QueryLog
}

/** 冒烟固定打这个成员：它是页面主入口，本地库里场次也最全。 */
const SMOKE_DATASET = 'nonoka'
const DEFAULT_ROUNDS = 20
const DATABASE_HINT = '在 .dev.vars 配置 DATABASE_URL；本地可先运行 bun run ymmt dev db'

export interface QuerySmokeData {
  datasets: { id: string, streams: number }[]
  nonoka: {
    total: number
    latest: string | null
    insights: number | null
    transcripts: number
    calendar: { events: number, states: Record<string, number> }
    dayPlan: number[]
    adminSchedule: number
  }
  group: {
    members: number
    days: number
    latest: number
    recent: number
    gallery: number
    compareBuckets: number
    compareMonths: number
  }
  listAndInsightsMs: { p50: number, p95: number }
  failures: string[]
}

export interface QuerySmokeResult {
  exitCode: number
  data: QuerySmokeData
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)
  return sorted[Math.max(0, index)] ?? 0
}

/**
 * 跑一遍页面查询并断言基本契约。
 *
 * 单条断言失败只累加到 `failures`，其余查询照旧执行；有失败时 `exitCode` 为 1。
 */
export async function runQuerySmoke(options: QuerySmokeOptions = {}): Promise<QuerySmokeResult> {
  const log = options.log ?? NOOP_LOG
  const rounds = Math.max(1, options.rounds ?? DEFAULT_ROUNDS)
  const failures: string[] = []

  const check = (condition: boolean, message: string): void => {
    if (!condition) failures.push(message)
  }

  const db = createDb(requireEnvVar('DATABASE_URL', DATABASE_HINT))

  const datasets = await getDatasets(db)
  check(datasets.length > 0, '没有 dataset')
  const target = await getDataset(db, SMOKE_DATASET)
  check(Boolean(target), `缺少 ${SMOKE_DATASET} dataset`)
  check((target?.streamCount ?? 0) > 0, `${SMOKE_DATASET} 没有场次`)

  const list = await listStreams(db, SMOKE_DATASET, { limit: 500 })
  check(list.total === target?.streamCount, 'listStreams.total 与 dataset.streamCount 不一致')
  check(list.streams.length === Math.min(list.total, 500), 'listStreams 行数与 total 不一致')
  for (let index = 1; index < list.streams.length; index += 1) {
    const previous = list.streams[index - 1]?.startedAt ?? ''
    const current = list.streams[index]?.startedAt ?? ''
    check(previous >= current, `listStreams 未按开播时间倒序: ${previous} < ${current}`)
    if (failures.length > 5) break
  }

  const latest = await getLatestStream(db, SMOKE_DATASET)
  check(latest?.videoId === list.streams[0]?.videoId, 'getLatestStream 与列表首行不一致')

  const now = new Date()
  const month = currentJstMonth(now)
  const calendarWindowRange = calendarWindow(month, 1, 1)
  const calendar = await getCalendarData(db, {
    from: `${calendarWindowRange.start}-01`,
    to: monthRange(calendarWindowRange.end).to,
    window: calendarWindowRange,
    datasetId: SMOKE_DATASET,
    now,
  })
  check(calendar.members.length === datasets.length, 'calendar 成员数与 datasets 不一致')
  check(
    calendar.events.every(
      event => event.datasetId === SMOKE_DATASET || event.participantIds.includes(SMOKE_DATASET),
    ),
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

  const insights = await getDatasetInsights(db, SMOKE_DATASET)
  check(insights === null || insights.totals.streamCount > 0, 'dataset_insights 数据异常')

  const transcriptEntries = await getTranscriptIndex(db, SMOKE_DATASET)
  for (let index = 1; index < transcriptEntries.length; index += 1) {
    const previous = transcriptEntries[index - 1]?.date ?? ''
    const current = transcriptEntries[index]?.date ?? ''
    check(previous >= current, `getTranscriptIndex 未按日期倒序: ${previous} < ${current}`)
    if (failures.length > 5) break
  }
  if (transcriptEntries[0]) {
    const meta = await getTranscriptMeta(db, SMOKE_DATASET, transcriptEntries[0].videoId)
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
    compare.data.months.every((value, index) => index === 0 || value > compare.data.months[index - 1]),
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

  // 对比页的密度按公开口径取；会员限定场在默认参数下本来就不返回。
  const densityIds = list.streams
    .filter(row => !isMemberOnly(row.availability))
    .slice(0, 3)
    .map(row => row.videoId)
  const densities = await getCompareDensityMap(db, SMOKE_DATASET, densityIds)
  check(
    densityIds.every(videoId => Array.isArray(densities[videoId])),
    'getCompareDensityMap 缺少所选场次的密度数组',
  )

  const timings: number[] = []
  for (let index = 0; index < rounds; index += 1) {
    const started = performance.now()
    await Promise.all([
      listStreams(db, SMOKE_DATASET, { limit: 500 }),
      getDatasetInsights(db, SMOKE_DATASET),
    ])
    timings.push(performance.now() - started)
  }

  for (const failure of failures) log.error(failure)

  return {
    exitCode: failures.length > 0 ? 1 : 0,
    data: {
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
    },
  }
}

/** 查询层冒烟 + 本地延迟；有断言失败时退出码 1。 */
export const dbQuerySpec: CommandSpec = {
  id: 'db.query',
  description: '查询层冒烟 + 本地延迟',
  details: '把页面用到的查询各跑一遍并做基本断言（排序、成员隔离、日期窗口），'
    + '再测 listStreams + getDatasetInsights 的 p50 / p95。\n'
    + '断言失败只累计、不中断，有失败时退出码 1，明细见 data.failures。',
  examples: [
    'bun run ymmt db query',
    'bun run ymmt db query --json',
  ],
  options: [],
  async run(ctx) {
    const result = await runQuerySmoke({ log: ctx.log })
    const { data } = result
    ctx.log.line(
      `冒烟：${SMOKE_DATASET} ${data.nonoka.total} 场，`
      + `listStreams+insights p50 ${data.listAndInsightsMs.p50} ms / `
      + `p95 ${data.listAndInsightsMs.p95} ms，失败 ${data.failures.length} 项`,
    )
    return { exitCode: result.exitCode, data }
  },
}
