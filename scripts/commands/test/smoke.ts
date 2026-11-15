/**
 * Workerd / 线上路由冒烟。
 *
 * 用法：先 `bun run preview` 或 `bun run cf:preview`，再 `bun run ymmt test smoke`。
 * 可通过 `BASE_URL` 或 `--url <base>` 指向其他环境。
 *
 * 结论以 `data` 返回（--json 时进信封），人读模式逐行打 ✓ / ✗。
 */
import { Option } from 'commander'
import type { CommandSpec } from '@scripts/lib/cli/runtime.ts'
import { createLogger, type Logger } from '@scripts/lib/cli/logger.ts'

export interface SmokeOptions {
  /** 覆盖 `BASE_URL`。 */
  url?: string
  log?: Logger
}

export interface SmokeCheck {
  path: string
  status: number
  expected: number
  ok: boolean
  detail?: string
}

export interface SmokeData {
  baseUrl: string
  checks: SmokeCheck[]
  failures: number
}

export interface SmokeResult {
  exitCode: number
  data: SmokeData
}

interface RouteExpectation {
  path: string
  status: number
  type?: string
}

const ROUTES: RouteExpectation[] = [
  { path: '/', status: 200 },
  { path: '/gallery', status: 200 },
  { path: '/calendar', status: 200 },
  { path: '/calendar?month=2026-10', status: 200 },
  { path: '/calendar?month=2026-10&view=agenda', status: 200 },
  { path: '/compare', status: 200 },
  { path: '/compare?members=nonoka,arale&type=sing&months=3', status: 200 },
  { path: '/about', status: 200 },
  { path: '/sitemap.xml', status: 200, type: 'xml' },
  { path: '/llms.txt', status: 200 },
  { path: '/schemas/stream-datapack.v2.json', status: 200, type: 'json' },
  { path: '/schemas/transcript.v1.json', status: 200, type: 'json' },
  { path: '/schemas/densities.v1.json', status: 200, type: 'json' },
  { path: '/robots.txt', status: 200 },
  { path: '/nonoka', status: 200 },
  { path: '/nonoka/streams', status: 200 },
  { path: '/nonoka/calendar', status: 200 },
  { path: '/nonoka/calendar?month=2026-10', status: 200 },
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
  { path: '/nope/calendar', status: 404 },
  { path: '/nonoka/stream/nope.md', status: 404 },
]

/**
 * 业务主体：逐条请求路由，比对状态码与 content-type，再查管理端保护、robots、noindex 与 Markdown 端点。
 *
 * 所有结论收集进 `data.checks`；有失败项时退出码 1。
 */
export async function runSmoke(options: SmokeOptions): Promise<SmokeResult> {
  const log = options.log ?? createLogger({ name: 'test.smoke' })
  const baseUrl = (options.url ?? process.env.BASE_URL ?? 'http://localhost:4321').replace(/\/+$/, '')
  const checks: SmokeCheck[] = []
  let failures = 0

  const record = (check: SmokeCheck, successNote = '', failureNote = ''): void => {
    checks.push(check)
    if (check.ok) {
      log.info(`✓ ${check.path}: ${check.status}${successNote ? ` ${successNote}` : ''}`)
      return
    }
    failures += 1
    log.error(`✗ ${check.path}: ${check.status}${failureNote ? ` ${failureNote}` : ''}`)
  }

  for (const route of ROUTES) {
    const response = await fetch(`${baseUrl}${route.path}`, { redirect: 'manual' })
    const type = response.headers.get('content-type') ?? ''
    const statusOk = response.status === route.status
    const typeOk = !route.type || type.includes(route.type)
    const note = typeOk ? '' : `(content-type ${type})`
    record({
      path: route.path,
      status: response.status,
      expected: route.status,
      ok: statusOk && typeOk,
      ...(note ? { detail: note } : {}),
    }, '', note)
  }

  // 管理端只接受已认证请求；未配置时返回 503，两种都算「已保护」。
  for (const path of ['/admin/schedule', '/api/admin/schedule']) {
    const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' })
    record({
      path,
      status: response.status,
      expected: 401,
      ok: response.status === 401 || response.status === 503,
      detail: '(expected 401 or 503)',
    }, '(protected)', '(expected 401 or 503)')
  }

  const robots = await fetch(`${baseUrl}/robots.txt`)
  const robotsText = await robots.text()
  record({
    path: '/robots.txt',
    status: robots.status,
    expected: 200,
    ok: robotsText.includes('Disallow: /admin/'),
    detail: '缺少 /admin/ 的 Disallow',
  }, '/admin/ disallowed', '缺少 /admin/ 的 Disallow')

  // 全员对比是分析页：确认 noindex，且筛选参数不会让页面变成 404。
  const compare = await fetch(`${baseUrl}/compare?members=nonoka&type=sing&months=all`)
  const compareHtml = await compare.text()
  record({
    path: '/compare?members=nonoka&type=sing&months=all',
    status: compare.status,
    expected: 200,
    ok: compare.ok && compareHtml.includes('noindex'),
    detail: '(missing noindex)',
  }, 'noindex', '(missing noindex)')

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
      record({
        path,
        status: md.status,
        expected: 200,
        ok: md.ok && contentType.includes('text/markdown'),
        detail: `(${contentType})`,
      }, 'text/markdown')
    }
  }

  if (failures > 0)
    log.error(`${failures} route(s) failed`)
  else
    log.info('all routes ok')

  return { exitCode: failures > 0 ? 1 : 0, data: { baseUrl, checks, failures } }
}

export const testSmokeSpec: CommandSpec = {
  id: 'test.smoke',
  description: '路由冒烟：状态码、content-type、管理端保护、noindex 与 Markdown 端点',
  details: '先起本地实例：`bun run preview` 或 `bun run cf:preview`。\n'
    + '目标地址默认 `BASE_URL`，可用 `--url <base>` 覆盖。任意一条失败即退出码 1。',
  examples: [
    'bun run ymmt test smoke',
    'bun run ymmt test smoke --url http://localhost:8787',
    'bun run ymmt test smoke --json',
  ],
  options: [new Option('--url <base>', '目标地址，默认 BASE_URL 或 http://localhost:4321')],
  async run(ctx) {
    const url = ctx.options.url
    const result = await runSmoke({
      url: typeof url === 'string' ? url : undefined,
      log: ctx.log,
    })
    return { exitCode: result.exitCode, data: result.data }
  },
}
