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
 *   - 只打印数量与登录检查，不打印任何 cookie 值。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
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
