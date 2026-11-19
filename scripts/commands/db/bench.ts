/**
 * 数据库读路径压测：经本地 Neon HTTP 代理走与 workerd 相同的驱动，
 * 测量每个页面查询组合的 SQL 条数、/sql 往返数与 p50/p95。
 *
 * 依赖本地库与代理：`bun run ymmt dev db` 之后由 ensureDevServices() 拉起。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Option } from 'commander'
import { type CommandSpec, CliError, type Logger } from '@chilfish/devkit/cli'
import { runBatch } from '@/db/batch.ts'
import { createDb, type Db } from '@/db/connection.ts'
import { getCalendarData } from '@/db/queries/calendar.ts'
import { selectDatasetsQuery } from '@/db/queries/datasets.ts'
import { getGroupCompareData } from '@/db/queries/group-compare.ts'
import {
  assembleStreamPack,
  buildStreamPackQueries,
  getStreamPack,
  type StreamPackParts,
} from '@/db/queries/packs.ts'
import {
  buildAllStreamHeadsQuery,
  buildAllStreamRefsQuery,
  getLatestStream,
  listStreams,
  selectStreamQuery,
  type StreamQueryRow,
} from '@/db/queries/streams.ts'
import {
  getTranscriptIndex,
  selectTranscriptMetaQuery,
} from '@/db/queries/transcripts.ts'
import {
  getCompareDensityMap,
  getComparePacks,
  getDatasetPageData,
  getGroupPageData,
  getStreamPageData,
  getStreamPageExtras,
} from '@/db/queries/view-data.ts'
import { calendarWindow, currentJstMonth, monthRange } from '@/lib/calendar.ts'
import { ensureDevServices } from '@chilfish/devkit/local'
import { devkit } from '../../dev.config.ts'

/** 只取命令需要的日志通道；默认空操作。 */
export type BenchLog = Pick<Logger, 'info' | 'warn' | 'error' | 'line'>

const NOOP_LOG: BenchLog = { info: () => {}, warn: () => {}, error: () => {}, line: () => {} }

export interface BenchOptions {
  /** 每个场景执行次数，默认 10。 */
  rounds?: number
  /** 结果标签，用于默认文件名与结果里的一行；默认 current。 */
  label?: string
  /** 写入 JSON 的路径，默认 temp/bench-db-<label>.json。 */
  out?: string
  /** 覆盖 DATABASE_URL。 */
  url?: string
  /** 覆盖 NEON_HTTP_ENDPOINT。 */
  endpoint?: string
  /** 只测不落盘（全局 --dry-run）。 */
  dryRun?: boolean
  log?: BenchLog
}

interface Measurement {
  name: string
  queries: number
  requests: number
  p50Ms: number
  p95Ms: number
  runs: number
}

export interface BenchPayload {
  label: string
  datasetId: string
  videoId: string
  rounds: number
  measuredAt: string
  node: string
  results: Measurement[]
}

/** 返回值在落盘 payload 之上补一个 `out`：dry-run 时为 null，不落盘。 */
export interface BenchData extends BenchPayload {
  out: string | null
}

export interface BenchResult {
  exitCode: number
  data: BenchData
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

const BENCH_DATASET = 'nonoka'
const DEFAULT_ROUNDS = 10

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
    run: async ({ db, datasetId, videoId }) => {
      const data = await getStreamPageData(db, datasetId, videoId)
      const extras = await getStreamPageExtras(db, datasetId, videoId, data?.neighborIds ?? [])
      return { data, extras }
    },
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
    name: 'compare-3-density',
    run: ({ db, datasetId, compareIds }) => Promise.all([
      getDatasetPageData(db, datasetId),
      getCompareDensityMap(db, datasetId, compareIds),
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

/**
 * 逐个场景压测，返回每个场景的平均 SQL 条数 / HTTP 往返数与 p50 / p95。
 *
 * `dryRun` 时不写 `--out` 文件，测量本身照旧（压测就是只读查询）。
 */
export async function runBench(options: BenchOptions = {}): Promise<BenchResult> {
  const log = options.log ?? NOOP_LOG
  const label = options.label ?? 'current'
  const rounds = Math.max(1, options.rounds ?? DEFAULT_ROUNDS)

  const services = await ensureDevServices({
    config: devkit,
    ...(options.url ? { databaseUrl: options.url } : {}),
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
  })
  if (!services.local) {
    throw new CliError('db bench 只接受本地数据库', {
      code: 'NOT_LOCAL_DATABASE',
      hint: '把 .dev.vars 的 DATABASE_URL 指回 localhost（或设 LOCAL=1），再运行 bun run ymmt dev db',
      context: { databaseUrl: services.databaseUrl },
    })
  }

  const db = createDb(services.databaseUrl, services.endpoint)

  const datasetId = BENCH_DATASET
  const latest = await getLatestStream(db, datasetId)
  if (!latest) {
    throw new CliError('本地库缺少 nonoka 场次', {
      code: 'EMPTY_DATABASE',
      hint: '先运行 bun run ymmt db ingest --dataset nonoka 写入本地 pack',
      context: { datasetId },
    })
  }
  const videoId = latest.videoId

  const listed = await listStreams(db, datasetId, { limit: 3, withTotal: false })
  const compareIds = listed.streams.map(stream => stream.videoId)
  const ctx: ScenarioContext = { db, datasetId, videoId, compareIds }

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

  const out = options.dryRun ? null : resolve(options.out ?? `temp/bench-db-${label}.json`)
  const payload: BenchPayload = {
    label,
    datasetId,
    videoId,
    rounds,
    measuredAt: new Date().toISOString(),
    node: process.version,
    results,
  }

  if (out) {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`)
  }
  else {
    log.info('dry-run：不写结果文件')
  }

  for (const item of results) {
    log.line(
      `${item.name}: SQL ${item.queries} / HTTP ${item.requests} / p50 ${item.p50Ms} ms / p95 ${item.p95Ms} ms`,
    )
  }
  log.info(`[db:bench] ${label} → ${out ?? '（dry-run，未落盘）'}`)

  // 落盘内容与旧脚本一致；`out` 只进返回值，方便 CI 直接取路径。
  return { exitCode: 0, data: { ...payload, out } }
}

/** 读路径压测：每个页面查询组合的 SQL 条数、HTTP 往返数与 p50 / p95。 */
export const dbBenchSpec: CommandSpec = {
  id: 'db.bench',
  description: '读路径压测（SQL 条数 / HTTP 往返 / p50 / p95）',
  details: '经本地 Neon HTTP 代理走与 workerd 相同的驱动，逐场景测量。\n'
    + '只接受本地库：先运行 bun run ymmt dev db。结果默认写入 temp/bench-db-<label>.json。',
  examples: [
    'bun run ymmt db bench',
    'bun run ymmt db bench --rounds 20 --label after',
    'bun run ymmt db bench --label baseline --out temp/bench-db-baseline.json',
    'bun run ymmt db bench --json',
  ],
  options: [
    new Option('--rounds <n>', `每个场景执行次数（默认 ${DEFAULT_ROUNDS}）`),
    new Option('--label <name>', '结果标签，例如 baseline / after（默认 current）'),
    new Option('--out <path>', '写入 JSON（默认 temp/bench-db-<label>.json）'),
    new Option('--url <url>', '覆盖 DATABASE_URL'),
    new Option('--endpoint <url>', '覆盖 NEON_HTTP_ENDPOINT'),
  ],
  async run(ctx) {
    const result = await runBench({
      ...(ctx.options.rounds === undefined ? {} : { rounds: ctx.integer('rounds', DEFAULT_ROUNDS, 1) }),
      ...(typeof ctx.options.label === 'string' ? { label: ctx.options.label } : {}),
      ...(typeof ctx.options.out === 'string' ? { out: ctx.options.out } : {}),
      ...(typeof ctx.options.url === 'string' ? { url: ctx.options.url } : {}),
      ...(typeof ctx.options.endpoint === 'string' ? { endpoint: ctx.options.endpoint } : {}),
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    const { data } = result
    return {
      exitCode: result.exitCode,
      data,
      summary: `压测完成：${data.results.length} 个场景 × ${data.rounds} 轮（${data.label}）${data.out ? ` → ${data.out}` : '，dry-run 未落盘'}`,
    }
  },
}
