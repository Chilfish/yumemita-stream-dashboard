/**
 * Workerd / 线上路由冒烟。
 * 用法：先 `bun run preview` 或 `bun run cf:preview`，再 `bun run test:smoke`。
 * 可通过 `BASE_URL` 或 `--url <base>` 指向其他环境。
 */
import process from 'node:process'

const args = process.argv.slice(2)
const urlIndex = args.indexOf('--url')
const baseUrl = (
  urlIndex >= 0 ? args[urlIndex + 1] : process.env.BASE_URL ?? 'http://localhost:4321'
).replace(/\/+$/, '')

const routes = [
  { path: '/', status: 200 },
  { path: '/gallery', status: 200 },
  { path: '/compare', status: 200 },
  { path: '/compare?members=nonoka,arale&type=sing&months=3', status: 200 },
  { path: '/about', status: 200 },
  { path: '/sitemap.xml', status: 200, type: 'xml' },
  { path: '/llms.txt', status: 200 },
  { path: '/robots.txt', status: 200 },
  { path: '/nonoka', status: 200 },
  { path: '/nonoka/streams', status: 200 },
  { path: '/nonoka/trends', status: 200 },
  { path: '/nonoka/gallery', status: 200 },
  { path: '/nonoka/transcripts', status: 200 },
  { path: '/nonoka/about', status: 302 },
  { path: '/nonoka/compare', status: 200 },
  { path: '/nonoka/overview', status: 302 },
  { path: '/nonoka/table', status: 302 },
  { path: '/nonoka/stream', status: 302 },
  { path: '/nonoka/stream/nope', status: 404 },
  { path: '/nope', status: 404 },
  { path: '/nonoka/stream/nope.md', status: 404 },
]

let failures = 0

for (const route of routes) {
  const response = await fetch(`${baseUrl}${route.path}`, { redirect: 'manual' })
  const type = response.headers.get('content-type') ?? ''
  const statusOk = response.status === route.status
  const typeOk = !route.type || type.includes(route.type)
  if (!statusOk || !typeOk) {
    failures += 1
    console.error(`✗ ${route.path}: ${response.status}${typeOk ? '' : ` (content-type ${type})`}`)
  }
  else {
    console.log(`✓ ${route.path}: ${response.status}`)
  }
}

// 全员对比是分析页：确认 noindex，且筛选参数不会让页面变成 404。
const compare = await fetch(`${baseUrl}/compare?members=nonoka&type=sing&months=all`)
const compareHtml = await compare.text()
if (!compare.ok || !compareHtml.includes('noindex')) {
  failures += 1
  console.error(`✗ /compare: ${compare.status} (missing noindex)`)
}
else {
  console.log('✓ /compare: noindex')
}

// 从 llms.txt 里取一条 Markdown 链接，确认端点可用。
const llms = await fetch(`${baseUrl}/llms.txt`)
if (llms.ok) {
  const text = await llms.text()
  const markdownUrl = text.match(/https?:\/\/\S+\/stream\/[^\s]+\.md/)?.[0]
  if (markdownUrl) {
    // llms.txt 里是生产绝对地址；冒烟时换成当前 baseUrl 再请求。
    const path = new URL(markdownUrl).pathname
    const md = await fetch(`${baseUrl}${path}`)
    const contentType = md.headers.get('content-type') ?? ''
    if (!md.ok || !contentType.includes('text/markdown')) {
      failures += 1
      console.error(`✗ ${path}: ${md.status} (${contentType})`)
    }
    else {
      console.log(`✓ ${path}: ${md.status} text/markdown`)
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} route(s) failed`)
  process.exitCode = 1
}
else {
  console.log('\nall routes ok')
}
