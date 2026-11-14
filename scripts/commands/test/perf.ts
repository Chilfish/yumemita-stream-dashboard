/**
 * 页面级性能冒烟：对预览 / 线上实例重复请求，记录响应体大小与耗时中位数。
 *
 * 用法：先 `bun run preview`，再 `bun run ymmt test perf`；可用 `BASE_URL` 或 `--url` 指定地址。
 * 结论以 `data` 返回（--json 时进信封），人读模式逐行打一行摘要。
 */
import { Option } from 'commander'
import type { CommandSpec } from '@scripts/lib/cli/runtime.ts'
import { createLogger, type Logger } from '@scripts/lib/cli/logger.ts'

export interface PerfOptions {
  url?: string
  /** 每条路由请求几次，默认 5。 */
  rounds?: number
  log?: Logger
}

export interface Measurement {
  path: string
  status: number
  medianMs: number
  medianBytes: number
  cacheTag: string | null
  contentType: string | null
}

export interface PerfData {
  baseUrl: string
  rounds: number
  results: Measurement[]
}

export interface PerfResult {
  exitCode: number
  data: PerfData
}

const ROUTES = [
  '/',
  '/gallery',
  '/compare',
  '/nonoka',
  '/nonoka/streams',
  '/nonoka/trends',
  '/nonoka/gallery',
  '/nonoka/transcripts',
  '/nonoka/compare',
  '/nonoka/stream/0Oom7elwKMo',
  '/nonoka/stream/0Oom7elwKMo.md',
  '/sitemap.xml',
  '/llms.txt',
]

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0)
}

/** 业务主体：每条路由请求 `rounds` 次，取耗时与响应体大小的中位数。 */
export async function runPerf(options: PerfOptions): Promise<PerfResult> {
  const log = options.log ?? createLogger({ name: 'test.perf' })
  const baseUrl = (options.url ?? process.env.BASE_URL ?? 'http://localhost:4321').replace(/\/+$/, '')
  const rounds = options.rounds ?? 5

  const results: Measurement[] = []

  for (const path of ROUTES) {
    const times: number[] = []
    const sizes: number[] = []
    let status = 0
    let cacheTag: string | null = null
    let contentType: string | null = null

    for (let round = 0; round < rounds; round += 1) {
      const started = performance.now()
      const response = await fetch(`${baseUrl}${path}`)
      const body = await response.arrayBuffer()
      times.push(performance.now() - started)
      sizes.push(body.byteLength)
      status = response.status
      cacheTag = response.headers.get('cache-tag')
      contentType = response.headers.get('content-type')
    }

    const measurement: Measurement = {
      path,
      status,
      medianMs: Number(median(times).toFixed(1)),
      medianBytes: Math.round(median(sizes)),
      cacheTag,
      contentType,
    }
    results.push(measurement)
    log.info(`${path}: ${measurement.status} ${measurement.medianMs}ms ${measurement.medianBytes}B`)
    log.debug(`${path} cache-tag=${cacheTag ?? '-'} content-type=${contentType ?? '-'}`)
  }

  log.info(`完成：${results.length} 条路由 × ${rounds} 轮，目标 ${baseUrl}`)

  return { exitCode: 0, data: { baseUrl, rounds, results } }
}

export const testPerfSpec: CommandSpec = {
  id: 'test.perf',
  description: '页面级性能冒烟：响应体大小与耗时中位数',
  details: '先起本地实例：`bun run preview`。\n'
    + '目标地址默认 `BASE_URL`，可用 `--url <base>` 覆盖；每条路由重复 `--rounds` 次后取中位数。',
  examples: [
    'bun run ymmt test perf',
    'bun run ymmt test perf --rounds 10',
    'bun run ymmt test perf --url http://localhost:8787 --json',
  ],
  options: [
    new Option('--url <base>', '目标地址，默认 BASE_URL 或 http://localhost:4321'),
    new Option('--rounds <n>', '每条路由请求次数，默认 5'),
  ],
  async run(ctx) {
    const url = ctx.options.url
    const result = await runPerf({
      url: typeof url === 'string' ? url : undefined,
      rounds: ctx.integer('rounds', 5, 1),
      log: ctx.log,
    })
    return { exitCode: result.exitCode, data: result.data }
  },
}
