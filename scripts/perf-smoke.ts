/**
 * 页面级性能冒烟：对预览 / 线上实例重复请求，记录响应体大小与耗时中位数。
 * 用法：先 `bun run preview`，再 `bun run perf:smoke`；可用 BASE_URL 或 --url 指定地址。
 */
import process from 'node:process'

const args = process.argv.slice(2)
const urlIndex = args.indexOf('--url')
const baseUrl = (
  urlIndex >= 0 ? args[urlIndex + 1] : process.env.BASE_URL ?? 'http://localhost:4321'
).replace(/\/+$/, '')
const rounds = Number(args[args.indexOf('--rounds') + 1]) || 5

const routes = [
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

interface Measurement {
  path: string
  status: number
  medianMs: number
  medianBytes: number
  cacheTag: string | null
  contentType: string | null
}

const results: Measurement[] = []

for (const path of routes) {
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

  results.push({
    path,
    status,
    medianMs: Number(median(times).toFixed(1)),
    medianBytes: Math.round(median(sizes)),
    cacheTag,
    contentType,
  })
}

console.log(JSON.stringify({ baseUrl, rounds, results }, null, 2))
