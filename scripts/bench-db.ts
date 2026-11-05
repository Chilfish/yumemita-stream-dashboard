#!/usr/bin/env bun
/**
 * 数据库读路径压测：经本地 Neon HTTP 代理走与 workerd 相同的驱动，
 * 测量每个页面查询组合的 SQL 条数、/sql 往返数与 p50/p95。
 *
 *   bun run db:bench
 *   bun run db:bench -- --rounds 20 --label after
 *   bun run db:bench -- --label baseline --out temp/bench-db-baseline.json
 *
 * 依赖本地库与代理：`bun run dev:db` 之后由 ensureDevServices() 拉起。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { runBatch } from '../src/db/batch.ts'
import { createDb, type Db } from '../src/db/connection.ts'
import { getCalendarData } from '../src/db/queries/calendar.ts'
import { selectDatasetsQuery } from '../src/db/queries/datasets.ts'
import { getGroupCompareData } from '../src/db/queries/group-compare.ts'
import {
  assembleStreamPack,
  buildStreamPackQueries,
  getStreamPack,
  type StreamPackParts,
} from '../src/db/queries/packs.ts'
import {
  buildAllStreamHeadsQuery,
  buildAllStreamRefsQuery,
  getLatestStream,
  listStreams,
  selectStreamQuery,
  type StreamQueryRow,
} from '../src/db/queries/streams.ts'
import {
  getTranscriptIndex,
  selectTranscriptMetaQuery,
} from '../src/db/queries/transcripts.ts'
import {
  getComparePacks,
  getDatasetPageData,
  getGroupPageData,
  getStreamPageExtras,
} from '../src/db/queries/view-data.ts'
import { calendarWindow, currentJstMonth, monthRange } from '../src/lib/calendar.ts'
import { ensureDevServices } from './lib/dev-services.ts'
import { loadEnvFiles } from './lib/env.ts'

const { values } = parseArgs({
  options: {
    rounds: { type: 'string', default: '10' },
    label: { type: 'string', default: 'current' },
    out: { type: 'string' },
    url: { type: 'string' },
    endpoint: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})

if (values.help) {
  console.log(`用法：bun scripts/bench-db.ts [选项]

选项：
  --rounds <n>      每个场景执行次数（默认 10）
  --label <name>    结果标签，例如 baseline / after
  --out <path>      写入 JSON（默认 temp/bench-db-<label>.json）
  --url <url>       覆盖 DATABASE_URL
  --endpoint <url>  覆盖 NEON_HTTP_ENDPOINT
  -h, --help        显示本帮助`)
  process.exit(0)
}

interface Health {
  ok: boolean
  queries: number
  requests: number
}

interface ScenarioContext {
  db: Db
  datasetId: string
  videoId: string
  compareIds: string[]
}

interface Scenario {
  name: string
  run: (ctx: ScenarioContext) => Promise<unknown>
}

interface Measurement {
  name: string
  queries: number
  requests: number
  p50Ms: number
  p95Ms: number
  runs: number
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)
  return sorted[Math.max(0, index)] ?? 0
}

async function readHealth(endpoint: string): Promise<Health> {
  const url = new URL(endpoint)
  url.pathname = '/health'
  url.search = ''
  const response = await fetch(url)
  if (!response.ok) throw new Error(`代理健康检查失败：HTTP ${response.status}`)
  return await response.json() as Health
}

const scenarios: Scenario[] = [
  {
    name: 'dataset-home',
    run: ({ db, datasetId }) => getDatasetPageData(db, datasetId),
  },
  {
    name: 'dataset-transcripts',
    run: ({ db, datasetId }) => Promise.all([
      getDatasetPageData(db, datasetId),
      getTranscriptIndex(db, datasetId),
    ]),
  },
  {
    name: 'stream-page',
    run: ({ db, datasetId, videoId }) => Promise.all([
      getDatasetPageData(db, datasetId),
      getStreamPageExtras(db, datasetId, videoId),
    ]),
  },
  {
    name: 'stream-md',
    run: async ({ db, datasetId, videoId }) => {
      // 第一轮：场次 + 成员 + 逐字稿元数据。
      await runBatch(db, [
        selectStreamQuery(db, datasetId, videoId),
        selectDatasetsQuery(db, datasetId),
        selectTranscriptMetaQuery(db, datasetId, videoId),
      ])
      // 第二轮：pack。
      return await getStreamPack(db, datasetId, videoId)
    },
  },
  {
    name: 'api-pack',
    run: async ({ db, datasetId, videoId }) => {
      const [, ...parts] = await runBatch<[StreamQueryRow[], ...StreamPackParts]>(db, [
        selectStreamQuery(db, datasetId, videoId),
        ...buildStreamPackQueries(db, datasetId, videoId, { words: 40, authors: 20 }),
      ])
      return assembleStreamPack(parts)
    },
  },
  {
    name: 'compare-3',
    run: ({ db, datasetId, compareIds }) => Promise.all([
      getDatasetPageData(db, datasetId),
      getComparePacks(db, datasetId, compareIds),
    ]),
  },
  {
    name: 'group-home',
    run: ({ db }) => getGroupPageData(db, 'home'),
  },
  {
    name: 'group-gallery',
    run: ({ db }) => getGroupPageData(db, 'gallery'),
  },
  {
    name: 'group-compare',
    run: ({ db }) => getGroupCompareData(db),
  },
  {
    name: 'group-calendar',
    run: async ({ db }) => {
      const now = new Date()
      const month = currentJstMonth(now)
      const window = calendarWindow(month, 6, 3)
      return await getCalendarData(db, {
        from: `${window.start}-01`,
        to: monthRange(window.end).to,
        window,
        now,
      })
    },
  },
  {
    name: 'sitemap',
    run: ({ db }) => runBatch(db, [
      selectDatasetsQuery(db, undefined),
      buildAllStreamRefsQuery(db),
    ]),
  },
  {
    name: 'llms-txt',
    run: ({ db }) => runBatch(db, [
      selectDatasetsQuery(db, undefined),
      buildAllStreamHeadsQuery(db),
    ]),
  },
]

async function main(): Promise<void> {
  loadEnvFiles()
  const services = await ensureDevServices({
    url: values.url,
    endpoint: values.endpoint,
  })
  if (!services.local) {
    throw new Error('db:bench 只接受本地数据库；请把 DATABASE_URL 指向 localhost')
  }

  const db = createDb(services.databaseUrl, services.endpoint)

  const datasetId = 'nonoka'
  const latest = await getLatestStream(db, datasetId)
  if (!latest) throw new Error('本地库缺少 nonoka 场次，先运行 bun run dev:seed')
  const videoId = latest.videoId

  const listed = await listStreams(db, datasetId, { limit: 3, withTotal: false })
  const compareIds = listed.streams.map(stream => stream.videoId)
  const ctx: ScenarioContext = { db, datasetId, videoId, compareIds }

  const rounds = Math.max(1, Number(values.rounds) || 10)
  const results: Measurement[] = []

  for (const scenario of scenarios) {
    await scenario.run(ctx)
    const timings: number[] = []
    let queries = 0
    let requests = 0

    for (let round = 0; round < rounds; round += 1) {
      const before = await readHealth(services.endpoint)
      const started = performance.now()
      await scenario.run(ctx)
      timings.push(performance.now() - started)
      const after = await readHealth(services.endpoint)
      queries += after.queries - before.queries
      requests += after.requests - before.requests
    }

    results.push({
      name: scenario.name,
      queries: Math.round(queries / rounds),
      requests: Math.round(requests / rounds),
      p50Ms: Number(percentile(timings, 0.5).toFixed(1)),
      p95Ms: Number(percentile(timings, 0.95).toFixed(1)),
      runs: rounds,
    })
  }

  const payload = {
    label: values.label,
    datasetId,
    videoId,
    rounds,
    measuredAt: new Date().toISOString(),
    node: process.version,
    results,
  }

  const out = resolve(values.out ?? `temp/bench-db-${values.label}.json`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`)

  console.table(results.map(item => ({
    scenario: item.name,
    SQL: item.queries,
    HTTP: item.requests,
    p50: `${item.p50Ms} ms`,
    p95: `${item.p95Ms} ms`,
  })))
  console.log(`[db:bench] ${values.label} → ${out}`)
}

await main()
