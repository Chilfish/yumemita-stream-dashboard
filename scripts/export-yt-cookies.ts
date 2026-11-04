#!/usr/bin/env bun
/**
 * 从本机浏览器导出 YouTube cookie（Netscape 格式），可选直接推到 GitHub Actions Secrets。
 *
 *   bun scripts/export-yt-cookies.ts                 # 导出到 ~/yt-cookies.txt（各抓取脚本默认复用）
 *   bun scripts/export-yt-cookies.ts --push          # 导出并 gh secret set YT_COOKIES
 *   bun scripts/export-yt-cookies.ts --browser edge --push
 *
 * 说明：
 *   - 文件是登录态会话，等同账号凭据；默认落在 home 目录，不会被 git 看到。
 *   - `fetch-streams` / `fetch-danmaku` / `fetch-live-chat` 等脚本默认读这份缓存，
 *     缺失时才自动导出；平时不需要手动跑本脚本。
 *   - CI 用 `--cookies <文件>` 读取；本地抓取也可以继续 `--cookies-from-browser firefox`。
 *   - 默认只保留 youtube.com / google.com：浏览器 profile 里还有 bilibili、pixiv 等
 *     别的站点会话，推到 CI 的 secret 里没有必要，漏出去反而更麻烦。
 *   - 只打印数量与登录检查，不打印任何 cookie 值。
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { defaultCookieCachePath, exportCookieJar } from './lib/yt-cookies.ts'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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
  --out <文件>       输出路径，默认 ~/yt-cookies.txt（抓取脚本共用）
  --url <地址>       触发导出的 YouTube 地址，默认取本地清单里最新一场，没有清单时用首个频道的 /streams
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

async function main(): Promise<void> {
  const { values } = parseArgs({ options: OPTIONS, args: process.argv.slice(2), allowPositionals: false })
  if (values.help) {
    console.log(USAGE)
    return
  }

  const out = resolve(values.out ?? defaultCookieCachePath())
  const url = values.url ?? latestVideoUrl()
    ?? (() => {
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
    })()
  if (!url) {
    console.error('[cookies] 找不到可用的 YouTube 地址：本地没有 data 清单，data-sources.json 里也没有 channelId。用 --url 指定一个视频页。')
    process.exit(1)
  }

  console.log(`[cookies] 从 ${values.browser} 导出，输出 ${out}`)
  console.log(`[cookies] 触发地址：${url}`)
  const domains = (values.domains ?? '').split(',').map(item => item.trim()).filter(Boolean)
  const result = await exportCookieJar({
    out,
    browser: values.browser,
    url,
    domains,
    log: line => console.log(`[cookies] ${line}`),
  })
  if (!result.ok || !result.info) {
    console.error(`[cookies] 导出失败：${result.error}`)
    console.error('[cookies] 确认浏览器已登录 YouTube，且浏览器进程已关闭。')
    process.exit(1)
  }
  if (result.filtered && result.filtered.after !== result.filtered.before)
    console.log(`[cookies] 按域裁剪：${result.filtered.before} → ${result.filtered.after} 条，保留 ${domains.join(' / ') || '全部'}`)
  console.log(`[cookies] 共 ${result.info.cookies} 条 cookie，其中 youtube.com ${result.info.youtube} 条，${Math.round(statSync(out).size / 1024)} KB`)
  if (!result.info.loggedIn) {
    console.error('[cookies] 没有找到登录态 cookie（SID / __Secure-3PSID）。先在浏览器登录 YouTube 再导出。')
    process.exit(1)
  }
  if (result.info.youtube === 0) {
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
