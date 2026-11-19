/**
 * 从本机浏览器导出 YouTube cookie（Netscape 格式），可选直接推到 GitHub Actions Secrets。
 *
 *   bun run ymmt tool cookies                 # 导出到 ~/yt-cookies.txt（各抓取脚本默认复用）
 *   bun run ymmt tool cookies --push          # 导出并 gh secret set YT_COOKIES
 *   bun run ymmt tool cookies --browser edge --push
 *
 * 说明：
 *   - 文件是登录态会话，等同账号凭据；默认落在 home 目录，不会被 git 看到。
 *   - `data fetch` / `data danmaku` / `data live-chat` 等命令默认读这份缓存，
 *     缺失时才自动导出；平时不需要手动跑本命令。
 *   - CI 用 `--cookies <文件>` 读取；本地抓取也可以继续 `--cookies-from-browser firefox`。
 *   - 默认只保留 youtube.com / google.com：浏览器 profile 里还有 bilibili、pixiv 等
 *     别的站点会话，推到 CI 的 secret 里没有必要，漏出去反而更麻烦。
 *   - 只打印数量与登录检查，不打印任何 cookie 值。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Option } from 'commander'
import { type CommandSpec, CliError, createLogger, type Logger } from '@chilfish/devkit/cli'
import { defaultCookieCachePath, exportCookieJar } from '@scripts/lib/yt-cookies.ts'

// 文件在 scripts/commands/tool/，仓库根在上三级。
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const DEFAULT_DOMAINS = 'youtube.com,google.com'

export interface ExportCookiesOptions {
  browser?: string
  out?: string
  url?: string
  /** 逗号分隔的域列表；空字符串 = 全留。 */
  domains?: string
  push?: boolean
  secret?: string
  repo?: string
  /** 全局 --dry-run：只解析目标地址与输出路径，不导出、不推送。 */
  dryRun?: boolean
  log?: Logger
}

export interface ExportCookiesData {
  out: string
  url: string
  browser: string
  domains: string[]
  cookies: number
  youtube: number
  loggedIn: boolean
  sizeKb: number | null
  filtered: { before: number, after: number } | null
  pushed: { repo: string, secret: string } | null
}

export interface ExportCookiesResult {
  exitCode: number
  data: ExportCookiesData
}

function run(command: string, args: string[], stdin?: string): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: [stdin == null ? 'ignore' : 'pipe', 'inherit', 'inherit'],
    })
    child.on('error', rejectPromise)
    child.on('close', code => resolvePromise(code ?? 1))
    if (stdin != null && child.stdin) {
      child.stdin.write(stdin)
      child.stdin.end()
    }
  })
}

async function capture(command: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout?.on('data', chunk => out.push(chunk as Buffer))
    child.stderr?.on('data', chunk => err.push(chunk as Buffer))
    child.on('error', rejectPromise)
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(out).toString('utf8').trim())
        return
      }
      rejectPromise(new Error(`${command} exit ${code}：${Buffer.concat(err).toString('utf8').trim()}`))
    })
  })
}

/** 最近一场的地址：让 yt-dlp 真的走一次 YouTube 请求，cookie 才会写盘。 */
function latestVideoUrl(): string | null {
  const dataRoot = join(APP_ROOT, 'data')
  if (!existsSync(dataRoot))
    return null
  let best: { startedAt: string, url: string } | null = null
  for (const dirent of readdirSync(dataRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory())
      continue
    const manifestPath = join(dataRoot, dirent.name, 'manifest.json')
    if (!existsSync(manifestPath))
      continue
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        streams?: { startedAt?: string | null, url?: string | null, videoId?: string | null }[]
      }
      for (const stream of manifest.streams ?? []) {
        const startedAt = stream.startedAt ?? ''
        const url = stream.url ?? (stream.videoId ? `https://www.youtube.com/watch?v=${stream.videoId}` : null)
        if (!url)
          continue
        if (!best || startedAt > best.startedAt)
          best = { startedAt, url }
      }
    }
    catch {
      // 某位成员的清单坏了不影响导出。
    }
  }
  return best?.url ?? null
}

/** data-sources.json 里首个 channelId 的 /streams，作为最后兜底。 */
function fallbackChannelUrl(): string | null {
  try {
    const sources = JSON.parse(readFileSync(join(APP_ROOT, 'data-sources.json'), 'utf8')) as {
      datasets?: { channelId?: string }[]
    }
    const channelId = sources.datasets?.find(item => item.channelId)?.channelId
    return channelId ? `https://www.youtube.com/channel/${channelId}/streams` : null
  }
  catch {
    return null
  }
}

/**
 * 业务主体：确定触发地址 → 用 yt-dlp 导出 cookie → 检查登录态 → 可选 `gh secret set`。
 *
 * 任何一步不满足（找不到地址、没登录态、没有 youtube.com 条目、gh 失败）都抛 `CliError`，
 * 由 runtime 落成退出码 1 与 `hint`。
 */
export async function runExportCookies(options: ExportCookiesOptions): Promise<ExportCookiesResult> {
  const log = options.log ?? createLogger({ name: 'tool.cookies' })
  const browser = options.browser ?? 'firefox'
  const secret = options.secret ?? 'YT_COOKIES'
  const out = resolve(options.out ?? defaultCookieCachePath())
  const domains = (options.domains ?? DEFAULT_DOMAINS).split(',').map(item => item.trim()).filter(Boolean)
  const url = options.url ?? latestVideoUrl() ?? fallbackChannelUrl()

  if (!url) {
    throw new CliError(
      '找不到可用的 YouTube 地址：本地没有 data 清单，data-sources.json 里也没有 channelId。用 --url 指定一个视频页。',
      {
        code: 'NO_TRIGGER_URL',
        hint: 'bun run ymmt tool cookies --url https://www.youtube.com/watch?v=<videoId>',
      },
    )
  }

  const data: ExportCookiesData = {
    out,
    url,
    browser,
    domains,
    cookies: 0,
    youtube: 0,
    loggedIn: false,
    sizeKb: null,
    filtered: null,
    pushed: null,
  }

  log.info(`从 ${browser} 导出，输出 ${out}`)
  log.info(`触发地址：${url}`)

  if (options.dryRun) {
    log.info('dry-run：只解析参数，不导出、不推送')
    return { exitCode: 0, data }
  }

  const result = await exportCookieJar({
    out,
    browser,
    url,
    domains,
    log: line => log.info(line),
  })
  if (!result.ok || !result.info) {
    throw new CliError(`导出失败：${result.error}`, {
      code: 'EXPORT_FAILED',
      hint: '确认浏览器已登录 YouTube，且浏览器进程已关闭；必要时用 --browser 指定正确的浏览器',
      context: { browser, out },
    })
  }

  data.cookies = result.info.cookies
  data.youtube = result.info.youtube
  data.loggedIn = result.info.loggedIn
  data.filtered = result.filtered
  data.sizeKb = Math.round(statSync(out).size / 1024)

  if (result.filtered && result.filtered.after !== result.filtered.before)
    log.info(`按域裁剪：${result.filtered.before} → ${result.filtered.after} 条，保留 ${domains.join(' / ') || '全部'}`)
  log.info(`共 ${result.info.cookies} 条 cookie，其中 youtube.com ${result.info.youtube} 条，${data.sizeKb} KB`)

  if (!result.info.loggedIn) {
    throw new CliError('没有找到登录态 cookie（SID / __Secure-3PSID）', {
      code: 'NOT_LOGGED_IN',
      hint: '先在浏览器登录 YouTube，关掉浏览器后重跑 bun run ymmt tool cookies',
      context: { browser },
    })
  }
  if (result.info.youtube === 0) {
    throw new CliError('没有任何 youtube.com cookie，导出的文件对 CI 没用', {
      code: 'NO_YOUTUBE_COOKIES',
      hint: '确认 --domains 没把 youtube.com 裁掉，并在浏览器里访问过 YouTube',
      context: { domains },
    })
  }

  if (!options.push) {
    log.info('已导出。要推到 CI：bun run ymmt tool cookies --push')
    return { exitCode: 0, data }
  }

  const repo = options.repo ?? await capture('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
  log.info(`推送到 ${repo} 的 Secrets：${secret}`)
  const body = readFileSync(out, 'utf8')
  const pushCode = await run('gh', ['secret', 'set', secret, '--repo', repo], body)
  if (pushCode !== 0) {
    throw new CliError(`gh secret set 失败（exit ${pushCode}）`, {
      code: 'GH_SECRET_FAILED',
      hint: '确认 gh 已登录且对目标仓库有 admin 权限（gh auth status）',
      context: { repo, secret },
    })
  }
  data.pushed = { repo, secret }
  log.info('完成。定时任务下次运行会带上这份 cookie。')

  return { exitCode: 0, data }
}

export const toolCookiesSpec: CommandSpec = {
  id: 'tool.cookies',
  description: '从本机浏览器导出 YouTube cookie（Netscape），可选推到 GitHub Actions Secrets',
  details: [
    '导出的文件是登录态凭据，等同账号密码：不要提交、不要贴到聊天里。默认落在 `~/yt-cookies.txt`，各抓取命令共用。',
    '默认只保留 youtube.com / google.com；浏览器 profile 里其它站点会话没必要进 CI secret。',
    '只打印数量与登录检查，不打印任何 cookie 值。',
    '全局 `--dry-run` 只解析目标地址与输出路径，不导出、不推送。',
  ].join('\n'),
  examples: [
    'bun run ymmt tool cookies',
    'bun run ymmt tool cookies --push',
    'bun run ymmt tool cookies --browser edge --push',
  ],
  options: [
    new Option('--browser <name>', 'firefox / chrome / edge / brave / safari，默认 firefox'),
    new Option('--out <文件>', '输出路径，默认 ~/yt-cookies.txt（抓取命令共用）'),
    new Option('--url <地址>', '触发导出的 YouTube 地址，默认取本地清单里最新一场，没有清单时用首个频道的 /streams'),
    new Option('--domains <列表>', `只保留这些域的 cookie，逗号分隔，默认 ${DEFAULT_DOMAINS}（空 = 全留）`),
    new Option('--push', '导出后执行 gh secret set'),
    new Option('--secret <名字>', 'Secrets 名称，默认 YT_COOKIES'),
    new Option('--repo <owner/repo>', '目标仓库；默认当前仓库'),
  ],
  async run(ctx) {
    const result = await runExportCookies({
      browser: typeof ctx.options.browser === 'string' ? ctx.options.browser : undefined,
      out: typeof ctx.options.out === 'string' ? ctx.options.out : undefined,
      url: typeof ctx.options.url === 'string' ? ctx.options.url : undefined,
      domains: typeof ctx.options.domains === 'string' ? ctx.options.domains : undefined,
      push: ctx.flag('push'),
      secret: typeof ctx.options.secret === 'string' ? ctx.options.secret : undefined,
      repo: typeof ctx.options.repo === 'string' ? ctx.options.repo : undefined,
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    return { exitCode: result.exitCode, data: result.data }
  },
}
