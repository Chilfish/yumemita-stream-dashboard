/**
 * YouTube 登录态 cookie 的通用来源：每次抓取开始时从本机浏览器导出到 `~/yt-cookies.txt`，
 * 整轮抓取复用；导出失败时退回旧缓存。
 *
 * 为什么每次都导出：
 * - 浏览器会轮换 `__Secure-*PSIDTS`，放久的缓存会失效。失效的 jar 比没有更糟：
 *   yt-dlp 带着它请求会命中 "Sign in to confirm you're not a bot"，而同一时刻
 *   `--cookies-from-browser` 却能正常读取。
 * - 导出只多一次 `--simulate` 请求，相对整轮抓取可以忽略。
 * - 文件落在 home 目录，脚本可以共用，也不在仓库里。
 *
 * 注意：缓存文件等同账号凭据。不要提交、不要贴到聊天里；泄露后在浏览器退出登录即可失效。
 *
 * 优先级：显式 `--cookie` 请求头 > 显式 `--cookies` 文件 > `YT_COOKIE` 环境变量 >
 * `~/yt-cookies.txt`（每次运行重新导出）> 匿名。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { netscapeCookieHeader } from './innertube-live.ts'

export const DEFAULT_COOKIE_BROWSER = 'firefox'
export const DEFAULT_COOKIE_DOMAINS = ['youtube.com', 'google.com']
/** 手工请求 watch 页 / InnerTube 只发 youtube.com 的 cookie，避免降级页。 */
const YOUTUBE_ONLY_DOMAINS = ['youtube.com']

export function youtubeCookieHeader(path: string): string | null {
  return netscapeCookieHeader(path, { domains: YOUTUBE_ONLY_DOMAINS })
}
/** 默认缓存路径；用户可在各脚本里用 `--cookie-cache` 覆盖。 */
export function defaultCookieCachePath(): string {
  return join(homedir(), 'yt-cookies.txt')
}

export interface CookieJarInfo {
  /** 非注释行数（真正的 cookie 条数）。 */
  cookies: number
  youtube: number
  /** 是否有登录态 cookie（SID / __Secure-*PSID）。 */
  loggedIn: boolean
}

export function inspectCookieJar(path: string): CookieJarInfo {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  // `#HttpOnly_` 是前缀标记；SID / __Secure-* 全是 HttpOnly，漏掉会误判成未登录。
  const cookies = lines
    .map(line => (line.startsWith('#HttpOnly_') ? line.slice('#HttpOnly_'.length).trim() : line.trim()))
    .filter(line => line && !line.startsWith('#'))
  const youtube = cookies.filter(line => /(^|\t)\.?youtube\.com\t/.test(line))
  const names = new Set(cookies.map(line => line.split('\t')[5]).filter(Boolean))
  const loggedIn = names.has('SID') || names.has('__Secure-3PSID') || names.has('__Secure-1PSID')
  return { cookies: cookies.length, youtube: youtube.length, loggedIn }
}

/**
 * 按域裁剪 Netscape cookie 文件。`#HttpOnly_` 只是前缀标记，不是注释，
 * 它的域也要参与匹配（YouTube 的 SID / __Secure-* 全是 HttpOnly）。
 */
export function filterCookieDomains(path: string, domains: string[]): { before: number, after: number } {
  const rows = readFileSync(path, 'utf8').split(/\r?\n/).filter(line => line.trim())
  if (domains.length === 0)
    return { before: rows.length, after: rows.length }

  const kept = rows.filter((line) => {
    // 头部注释要留着：yt-dlp 靠 "# Netscape HTTP Cookie File" 识别文件格式。
    if (line.startsWith('#') && !line.startsWith('#HttpOnly_'))
      return true
    const domain = line.replace(/^#HttpOnly_/, '').split('\t')[0] ?? ''
    const bare = domain.replace(/^\./, '')
    return domains.some(item => bare === item || bare.endsWith(`.${item}`))
  })
  writeFileSync(path, `${kept.join('\n')}\n`, 'utf8')
  return { before: rows.length, after: kept.length }
}

/** data-sources.json 的第一个 channelId → /streams，作为没有具体视频时的导出触发地址。 */
export function fallbackYouTubeUrl(appRoot: string): string | null {
  try {
    const config = JSON.parse(readFileSync(join(appRoot, 'data-sources.json'), 'utf8')) as {
      datasets?: { channelId?: string }[]
    }
    const channelId = config.datasets?.find(item => item.channelId)?.channelId
    return channelId ? `https://www.youtube.com/channel/${channelId}/streams` : null
  }
  catch {
    return null
  }
}

function runYtdlp(args: string[], timeoutMs: number): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    const timer = timeoutMs > 0
      ? setTimeout(() => {
          child.kill()
          rejectPromise(new Error(`yt-dlp 导出 cookie 超时（${Math.round(timeoutMs / 1000)}s）`))
        }, timeoutMs)
      : null
    child.on('error', (error) => {
      if (timer)
        clearTimeout(timer)
      rejectPromise(error)
    })
    child.on('close', (code) => {
      if (timer)
        clearTimeout(timer)
      if (code !== 0 && stderr.trim())
        process.stderr.write(stderr.trimEnd().split('\n').slice(-3).join('\n') + '\n')
      resolvePromise(code ?? 1)
    })
  })
}

export interface ExportCookieOptions {
  /** 导出的目标文件；写入前先落到 `<out>.tmp`，成功后再 rename。 */
  out: string
  browser?: string
  /** 触发导出的 YouTube 地址；没有时用 `appRoot` 里的首个频道 /streams。 */
  url?: string
  appRoot?: string
  domains?: string[]
  timeoutMs?: number
  log?: (line: string) => void
}

export interface ExportCookieResult {
  ok: boolean
  path: string
  info: CookieJarInfo | null
  filtered: { before: number, after: number } | null
  error: string | null
}

/** 用 yt-dlp 从浏览器导出 cookie 到指定路径（Netscape 格式，按域裁剪）。 */
export async function exportCookieJar(options: ExportCookieOptions): Promise<ExportCookieResult> {
  const log = options.log ?? (() => {})
  const out = resolve(options.out)
  const url = options.url ?? (options.appRoot ? fallbackYouTubeUrl(options.appRoot) : null)
  const fail = (error: string): ExportCookieResult => ({ ok: false, path: out, info: null, filtered: null, error })
  if (!url)
    return fail('找不到触发导出的 YouTube 地址；用 --url 指定一个视频页')

  mkdirSync(dirname(out), { recursive: true })
  const tmp = `${out}.tmp`
  if (existsSync(tmp))
    unlinkSync(tmp)

  const args = [
    '--cookies-from-browser',
    options.browser ?? DEFAULT_COOKIE_BROWSER,
    '--cookies',
    tmp,
    '--skip-download',
    '--simulate',
    '--no-warnings',
    '--socket-timeout',
    '30',
    '--retries',
    '2',
  ]
  // 频道页需要 flat-playlist 才不会枚举整页；单个视频直接抽详情更快。
  if (/\/channel\/|\/@/.test(url))
    args.push('--flat-playlist', '--playlist-items', '1')
  args.push(url)

  let code: number
  try {
    code = await runYtdlp(args, options.timeoutMs ?? 120_000)
  }
  catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
  if (!existsSync(tmp))
    return fail(`yt-dlp 没有写出 cookie 文件（exit ${code}）；确认浏览器已登录 YouTube，且浏览器进程已关闭`)

  let filtered: { before: number, after: number }
  let info: CookieJarInfo
  try {
    filtered = filterCookieDomains(tmp, options.domains ?? DEFAULT_COOKIE_DOMAINS)
    info = inspectCookieJar(tmp)
  }
  catch (error) {
    if (existsSync(tmp))
      unlinkSync(tmp)
    return fail(`处理 cookie 文件失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (info.youtube === 0) {
    unlinkSync(tmp)
    return fail('导出的 cookie 里没有 youtube.com 条目')
  }
  renameSync(tmp, out)
  if (!info.loggedIn)
    log(`cookie 已导出，但没有登录态（SID）；会员限定场次可能仍然失败`)
  log(`cookie 已导出：${out}（${info.cookies} 条，youtube.com ${info.youtube} 条）`)
  return {
    ok: true,
    path: out,
    info,
    filtered,
    error: code !== 0 ? `yt-dlp exit ${code}，但 cookie 文件已写出` : null,
  }
}

export interface EnsureCookieJarOptions {
  browser?: string
  cachePath?: string
  /** 缓存最多复用多久；默认 0 = 本次调用就重新导出。 */
  maxAgeMs?: number
  domains?: string[]
  url?: string
  appRoot?: string
  log?: (line: string) => void
}

export interface CookieJar {
  path: string
  /** 本次是否真的重新导出过。 */
  refreshed: boolean
  info: CookieJarInfo
  error: string | null
}

/**
 * 确保 `~/yt-cookies.txt` 可用：默认每次调用都从浏览器重新导出，
 * 导出失败但旧缓存还在时继续用旧缓存。返回 null 表示只能匿名抓取。
 */
export async function ensureCookieJar(options: EnsureCookieJarOptions = {}): Promise<CookieJar | null> {
  const log = options.log ?? (() => {})
  const cachePath = resolve(options.cachePath ?? defaultCookieCachePath())
  const maxAgeMs = options.maxAgeMs ?? 0
  const exists = existsSync(cachePath)
  const ageMs = exists ? Date.now() - statSync(cachePath).mtimeMs : 0
  // 默认 0 = 每次都重新导出。浏览器的 `__Secure-*PSIDTS` 会轮换，
  // 旧 jar 拿在手里反而会被 YouTube 判成机器人。
  const stale = exists && (maxAgeMs <= 0 || ageMs > maxAgeMs)

  if (exists && !stale) {
    try {
      const info = inspectCookieJar(cachePath)
      if (info.youtube > 0)
        return { path: cachePath, refreshed: false, info, error: null }
      log(`cookie 缓存没有 youtube.com 条目，重新导出：${cachePath}`)
    }
    catch {
      log(`cookie 缓存损坏，重新导出：${cachePath}`)
    }
  }
  else if (exists && maxAgeMs > 0) {
    log(`cookie 缓存已超过 ${Math.round(maxAgeMs / 3_600_000)} 小时，重新导出`)
  }

  const reason = !exists ? '首次导出' : maxAgeMs > 0 ? '缓存过期' : '重新导出'
  log(`${reason}：从 ${options.browser ?? DEFAULT_COOKIE_BROWSER} 导出到 ${cachePath}`)
  const result = await exportCookieJar({
    out: cachePath,
    browser: options.browser,
    domains: options.domains,
    url: options.url,
    appRoot: options.appRoot,
    log,
  })
  if (result.ok && result.info)
    return { path: cachePath, refreshed: true, info: result.info, error: result.error }

  if (exists) {
    try {
      const info = inspectCookieJar(cachePath)
      if (info.youtube > 0) {
        log(`导出失败（${result.error}）；继续使用旧缓存`)
        return { path: cachePath, refreshed: false, info, error: result.error }
      }
    }
    catch {
      // 旧缓存也不可用，落到匿名
    }
  }
  log(`拿不到 cookie（${result.error}）；以未登录状态抓取`)
  return null
}

export interface ResolveCookiesOptions extends EnsureCookieJarOptions {
  /** `--cookie`：完整的 Cookie 请求头。 */
  cookie?: string | null
  /** `--cookies`：显式的 Netscape cookie jar。 */
  cookies?: string | null
  /** 环境变量里的 Cookie 请求头（默认 YT_COOKIE）。 */
  envCookie?: string | null
  /** `--no-cookies`：不读缓存也不导出。 */
  disable?: boolean
}

export interface ResolvedCookies {
  header: string | null
  /** 可交给 yt-dlp 的 `--cookies` 文件；显式 header 来源时为 null。 */
  jarPath: string | null
  source: 'header' | 'file' | 'env' | 'cache' | 'none'
  note?: string
}

/** 按优先级解析出一套请求头 + 可复用的 cookie jar。 */
export async function resolveCookies(options: ResolveCookiesOptions = {}): Promise<ResolvedCookies> {
  if (options.cookie) {
    return { header: options.cookie, jarPath: options.cookies ? resolve(options.cookies) : null, source: 'header' }
  }
  if (options.cookies) {
    const path = resolve(options.cookies)
    if (existsSync(path))
      return { header: youtubeCookieHeader(path), jarPath: path, source: 'file' }
    return { header: null, jarPath: null, source: 'none', note: `cookie 文件不存在：${path}` }
  }
  if (options.envCookie)
    return { header: options.envCookie, jarPath: null, source: 'env' }

  if (options.disable)
    return { header: null, jarPath: null, source: 'none', note: '已加 --no-cookies' }

  const jar = await ensureCookieJar(options)
  if (!jar)
    return { header: null, jarPath: null, source: 'none' }
  return { header: youtubeCookieHeader(jar.path), jarPath: jar.path, source: 'cache' }
}

/**
 * yt-dlp 的 cookie 参数：显式 jar > 缓存 jar > 浏览器直读。
 * 显式 `--cookie` 请求头无法转给 yt-dlp，这种情况下仍然回退浏览器；
 * `--no-cookies` 必须保持匿名，不能靠回退把浏览器 cookie 又带回来。
 */
export function ytdlpCookieArgs(
  resolved: Pick<ResolvedCookies, 'jarPath' | 'source'>,
  options: { browser?: string } = {},
): string[] {
  if (resolved.jarPath)
    return ['--cookies', resolved.jarPath]
  if (resolved.source === 'none')
    return []
  return ['--cookies-from-browser', options.browser ?? DEFAULT_COOKIE_BROWSER]
}
