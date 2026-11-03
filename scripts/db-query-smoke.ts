import process from 'node:process'
import { createDb } from '../src/db/connection.ts'
import { getDatasets, getDataset } from '../src/db/queries/datasets.ts'
import { getGroupGallery, getGroupSummary } from '../src/db/queries/group.ts'
import { getDatasetInsights } from '../src/db/queries/insights.ts'
import {
  getLatestStream,
  getStreamNeighbors,
  listStreams,
} from '../src/db/queries/streams.ts'
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

  const middle = list.streams[Math.floor(list.streams.length / 2)]
  if (middle) {
    const neighbors = await getStreamNeighbors(db, 'nonoka', middle.videoId)
    check(Boolean(neighbors.previous || neighbors.next), 'getStreamNeighbors 没有邻居')
  }

  const insights = await getDatasetInsights(db, 'nonoka')
  check(insights === null || insights.totals.streamCount > 0, 'dataset_insights 数据异常')

  const summary = await getGroupSummary(db)
  check(summary.members.length > 0, 'group summary 没有成员')
  check(summary.recent.length > 0, 'group summary 没有 recent')
  const gallery = await getGroupGallery(db)
  check(gallery.streams.length > 0, 'group gallery 没有场次')

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
    },
    group: {
      members: summary.members.length,
      days: summary.days.length,
      latest: summary.latest.length,
      recent: summary.recent.length,
      gallery: gallery.streams.length,
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
