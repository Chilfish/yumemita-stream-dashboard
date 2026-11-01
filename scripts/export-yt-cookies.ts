#!/usr/bin/env bun
/**
 * 从本机浏览器导出 YouTube cookie（Netscape 格式），可选直接推到 GitHub Actions Secrets。
 *
 *   bun scripts/export-yt-cookies.ts                 # 只导出到 node_modules/.cache
 *   bun scripts/export-yt-cookies.ts --push          # 导出并 gh secret set YT_COOKIES
 *   bun scripts/export-yt-cookies.ts --browser edge --push
 *
 * 说明：
 *   - 文件是登录态会话，等同账号凭据；默认落在 gitignore 的 node_modules/.cache 下，不要提交。
 *   - CI 用 `--cookies <文件>` 读取；本地抓取仍可直接 `--cookies-from-browser firefox`。
 *   - 默认只保留 youtube.com / google.com：浏览器 profile 里还有 bilibili、pixiv 等
 *     别的站点会话，推到 CI 的 secret 里没有必要，漏出去反而更麻烦。
 *   - 只打印数量与登录检查，不打印任何 cookie 值。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_OUT = join(APP_ROOT, 'node_modules', '.cache', 'stream-dashboard', 'yt-cookies.txt')
/** yt-dlp 自己的测试视频，几乎不会下架；拿不到 manifest 时用它触发一次请求。 */
const FALLBACK_URL = 'https://www.youtube.com/watch?v=BaW_jenozKc'

const OPTIONS = {
  browser: { type: 'string', default: 'firefox' },
  out: { type: 'string' },
  url: { type: 'string' },
  domains: { type: 'string', default: 'youtube.com,google.com' },
  push: { type: 'boolean' },
  secret: { type: 'string', default: 'YT_COOKIES' },
  repo: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const

const USAGE = `用法：bun scripts/export-yt-cookies.ts [选项]

从本机浏览器导出 YouTube cookie 到 Netscape 文件，可选推送到 GitHub Actions Secrets。

选项：
  --browser <name>   firefox / chrome / edge / brave / safari，默认 firefox
  --out <文件>       输出路径，默认 node_modules/.cache/stream-dashboard/yt-cookies.txt
  --url <地址>       触发导出的 YouTube 地址，默认取本地清单里最新一场
  --domains <列表>   只保留这些域的 cookie，逗号分隔，默认 youtube.com,google.com（空 = 全留）
  --push             导出后执行 gh secret set
  --secret <名字>    Secrets 名称，默认 YT_COOKIES
  --repo <owner/repo> 目标仓库；默认当前仓库
  -h, --help         显示本帮助

提醒：导出的文件是登录态凭据，等同账号密码，不要提交、不要贴到聊天里。`

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

/**
 * 按域裁剪 Netscape cookie 文件。`#HttpOnly_` 只是前缀标记，不是注释，
 * 它的域也要参与匹配（YouTube 的 SID / __Secure-* 全是 HttpOnly）。
 */
function filterDomains(path: string, domains: string[]): { before: number, after: number } {
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

function inspect(path: string): { lines: number, youtube: number, loggedIn: boolean } {
  const text = readFileSync(path, 'utf8')
  const lines = text.split(/\r?\n/)
  const cookies = lines.filter(line => line.trim() && !line.startsWith('#'))
  const youtube = cookies.filter(line => /(^|\t)\.?youtube\.com\t/.test(line))
  // Netscape 格式：domain / includeSubdomains / path / secure / expiry / name / value
  const names = new Set(cookies.map(line => line.split('\t')[5]).filter(Boolean))
  const loggedIn = names.has('SID') || names.has('__Secure-3PSID') || names.has('__Secure-1PSID')
  return { lines: cookies.length, youtube: youtube.length, loggedIn }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: OPTIONS, args: process.argv.slice(2), allowPositionals: false })
  if (values.help) {
    console.log(USAGE)
    return
  }

  const out = resolve(values.out ?? DEFAULT_OUT)
  mkdirSync(dirname(out), { recursive: true })
  const url = values.url ?? latestVideoUrl() ?? FALLBACK_URL

  console.log(`[cookies] 从 ${values.browser} 导出，输出 ${out}`)
  console.log(`[cookies] 触发地址：${url}`)
  // 旧文件被裁剪坏了的话 yt-dlp 会直接报「不是 Netscape 格式」并且不写盘；
  // cookie 的唯一来源是浏览器，先删掉重来最省事。
  if (existsSync(out))
    unlinkSync(out)

  const code = await run('yt-dlp', [
    '--cookies-from-browser', values.browser,
    '--cookies', out,
    '--skip-download',
    '--simulate',
    '--no-warnings',
    url,
  ])
  if (!existsSync(out)) {
    console.error(`[cookies] yt-dlp 没有写出 cookie 文件（exit ${code}）。确认浏览器已登录 YouTube，且浏览器进程已关闭。`)
    process.exit(1)
  }
  if (code !== 0)
    console.warn(`[cookies] yt-dlp exit ${code}，但 cookie 文件已写出，继续检查`)

  const domains = (values.domains ?? '').split(',').map(item => item.trim()).filter(Boolean)
  const filtered = filterDomains(out, domains)
  if (filtered.after !== filtered.before) {
    console.log(`[cookies] 按域裁剪：${filtered.before} → ${filtered.after} 条，保留 ${domains.join(' / ')}`)
  }

  const info = inspect(out)
  const size = statSync(out).size
  console.log(`[cookies] 共 ${info.lines} 条 cookie，其中 youtube.com ${info.youtube} 条，${Math.round(size / 1024)} KB`)
  if (!info.loggedIn) {
    console.error('[cookies] 没有找到登录态 cookie（SID / __Secure-3PSID）。先在浏览器登录 YouTube 再导出。')
    process.exit(1)
  }
  if (info.youtube === 0) {
    console.error('[cookies] 没有任何 youtube.com cookie，导出的文件对 CI 没用。')
    process.exit(1)
  }

  if (!values.push) {
    console.log(`[cookies] 已导出。要推到 CI：bun scripts/export-yt-cookies.ts --push`)
    return
  }

  const repo = values.repo ?? await capture('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
  console.log(`[cookies] 推送到 ${repo} 的 Secrets：${values.secret}`)
  const body = readFileSync(out, 'utf8')
  const pushCode = await run('gh', ['secret', 'set', values.secret, '--repo', repo], body)
  if (pushCode !== 0) {
    console.error(`[cookies] gh secret set 失败（exit ${pushCode}）`)
    process.exit(1)
  }
  console.log('[cookies] 完成。定时任务下次运行会带上这份 cookie。')
}

await main()
