#!/usr/bin/env bun
/**
 * 只补缺失场次的弹幕回放，不碰 meta / 评论 / VSTATS。
 *
 *   bun scripts/fetch-danmaku.ts --dataset nonoka --video W0bKqP-Eyj4
 *   bun scripts/fetch-danmaku.ts --root "D:/projects/claude-messages/temp/youtube-live"
 *   bun scripts/fetch-danmaku.ts --dataset arale --limit 20 --concurrency 3
 *   bun scripts/fetch-danmaku.ts --dataset yuno --engine yt-dlp --cookies-from-browser firefox
 *
 * 默认走 InnerTube 回放（`get_live_chat_replay`，匿名可用），与实时采集共用同一套
 * 归一化：消息 / 非消息事件 / 频道表情一起落盘。watch 页没有回放聊天时回退 yt-dlp
 * 的 `live_chat` 字幕（会员限定场次需要 cookie）。
 *
 * 输入默认读 `data/missing-danmaku/<dataset>.txt`（由缺失清单生成）。
 * 已有 `danmaku_<videoId>.jsonl` 或 `work/chat-unavailable.txt` 的场次会跳过，可反复执行。
 *
 * 输出：
 *   <root>/<日期>_<成员>_<videoId>/danmaku/danmaku_<videoId>.jsonl
 *   <root>/<日期>_<成员>_<videoId>/danmaku/events_<videoId>.jsonl   （InnerTube 非消息事件）
 *   <root>/<日期>_<成员>_<videoId>/danmaku/emoji_<videoId>.json      （InnerTube 频道表情）
 *   <root>/<日期>_<成员>_<videoId>/work/chat-unavailable.txt         （没有弹幕回放时）
 *
 * InnerTube 中断后重跑会从 `work/replay-state.json` 接着翻；`--engine yt-dlp`
 * 才下载原始 `.live_chat.json`，成功后默认删掉，加 `--keep-raw` 保留。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { normalizeLiveChat } from './lib/live-chat.ts'
import { mergeDanmakuFiles } from './lib/danmaku-merge.ts'
import { collectReplay } from './lib/live-chat-collect.ts'
import { loadEnvFiles } from './lib/env.ts'
import { resolveCookies, ytdlpCookieArgs } from './lib/yt-cookies.ts'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')
const MISSING_DIR = join(APP_ROOT, 'data', 'missing-danmaku')

interface DatasetSource {
  id: string
  label: string
  datapackDir: string
}

const ENGINE_NAMES = new Set(['auto', 'innertube', 'yt-dlp'])
type Engine = 'auto' | 'innertube' | 'yt-dlp'

const { values } = parseArgs({
  options: {
    dataset: { type: 'string', multiple: true },
    root: { type: 'string' },
    video: { type: 'string', multiple: true },
    ids: { type: 'string' },
    concurrency: { type: 'string', default: '3' },
    limit: { type: 'string', default: '0' },
    shard: { type: 'string' },
    engine: { type: 'string', default: 'auto' },
    force: { type: 'boolean' },
    'keep-raw': { type: 'boolean' },
    cookie: { type: 'string' },
    cookies: { type: 'string' },
    'cookies-from-browser': { type: 'string', default: 'firefox' },
    'page-delay': { type: 'string', default: '150' },
    'max-pages': { type: 'string', default: '0' },
    'no-resume': { type: 'boolean' },
    'cookie-cache': { type: 'string' },
    'no-cookies': { type: 'boolean' },
    'no-force-ipv4': { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})

const USAGE = `用法：bun scripts/fetch-danmaku.ts [--root <会话根目录>] [选项]

只抓缺失场次的弹幕回放，不重新抓 meta / 评论 / VSTATS。

选项：
  --dataset <id>             只处理指定 dataset，可重复；默认读 data/missing-danmaku/ 下全部
  --root <目录>              原始会话根目录（默认 $STREAM_SESSION_ROOT 或 ./temp/youtube-live）
  --video <id>               直接指定视频 ID，可重复；需同时指定一个 --dataset
  --ids <文件>               直接读 videoId 列表（每行一个），需同时指定一个 --dataset
  --engine <auto|innertube|yt-dlp>  默认 auto：InnerTube 回放优先，无回放时回退 yt-dlp
  --concurrency <n>          并发，默认 3
  --limit <n>                本次最多处理 n 场，0 = 全部
  --shard <i/n>              多实例分片：只处理第 i 片（1 起），例如 1/4、2/4
  --force                    已有 jsonl 也重抓；InnerTube 会从头翻并与旧档合并
  --keep-raw                 保留原始 .live_chat.json（仅 yt-dlp 引擎）
  --cookie <字符串>          InnerTube 的 Cookie 请求头（会员限定需要）；也可用 YT_COOKIE
  --cookies <文件>           Netscape cookie jar；InnerTube 直接读，yt-dlp 传 --cookies
  --cookies-from-browser <b> 导出 cookie / yt-dlp 回退时用哪个浏览器，默认 firefox
  --cookie-cache <文件>      cookie 缓存路径，默认 ~/yt-cookies.txt
  --no-cookies               不使用 cookie，以匿名状态抓取
  --page-delay <ms>          InnerTube 每页间隔，默认 150
  --max-pages <n>            InnerTube 最多翻多少页，0 = 不限（安全阀）
  --no-resume                不读 work/replay-state.json，从 watch 页重新翻
  --no-force-ipv4            不强制 IPv4（仅 yt-dlp 引擎）
  --dry-run                  只列出候选
  -h, --help                 显示本帮助

InnerTube 回放匿名可用；被删除 / 封禁账号的历史消息只在 yt-dlp 字幕档里，
需要完整历史时对已有场次用 --force --engine yt-dlp 再抓一次。
会员限定的实时 / 回放需要 cookie；失败会打印并保留在清单里，下次重跑。`

if (values.help) {
  console.log(USAGE)
  process.exit(0)
}

loadEnvFiles()

const engineRaw = values.engine ?? 'auto'
if (!ENGINE_NAMES.has(engineRaw)) {
  console.error(`[fetch:danmaku] --engine 只支持 auto / innertube / yt-dlp，收到：${engineRaw}`)
  process.exit(1)
}
const engine = engineRaw as Engine

const root = resolve(values.root ?? process.env.STREAM_SESSION_ROOT ?? join(APP_ROOT, 'temp', 'youtube-live'))
if (!existsSync(root)) {
  console.error('[fetch:danmaku] 请用 --root 指定归档的会话根目录（或设置 STREAM_SESSION_ROOT）')
  process.exit(1)
}

const concurrency = Math.max(1, Number(values.concurrency) || 3)
const limit = Math.max(0, Number(values.limit) || 0)
const forceIpv4 = !values['no-force-ipv4']
const pageDelayMs = Math.max(0, Number(values['page-delay']) || 0)
const maxPages = Math.max(0, Number(values['max-pages']) || 0)

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { datasets: DatasetSource[] }
const byId = new Map(config.datasets.map(source => [source.id, source]))
const selected = values.dataset && values.dataset.length > 0
  ? values.dataset.map((id) => {
      const source = byId.get(id)
      if (!source) {
        console.error(`[fetch:danmaku] data-sources.json 里没有 dataset：${id}`)
        process.exit(1)
      }
      return source
    })
  : config.datasets

if ((values.ids || values.video) && selected.length !== 1) {
  console.error('[fetch:danmaku] 用 --ids / --video 时请同时指定且只指定一个 --dataset，避免把 ID 写进错误的成员目录')
  process.exit(1)
}

/** 接受裸 videoId 或完整 URL；非法输入直接报错，避免把垃圾写进清单。 */
function normalizeVideoId(raw: string): string {
  const trimmed = raw.trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed))
    return trimmed
  const match = /(?:v=|youtu\.be\/|\/live\/)([A-Za-z0-9_-]{11})/.exec(trimmed)
  if (match)
    return match[1]!
  console.error(`[fetch:danmaku] 不是有效的 videoId 或 YouTube 链接：${raw}`)
  process.exit(1)
}

function readDirectIds(): string[] | null {
  if (!values.video && !values.ids)
    return null
  const ids: string[] = []
  for (const raw of values.video ?? [])
    ids.push(normalizeVideoId(raw))
  if (values.ids) {
    const path = resolve(values.ids)
    if (!existsSync(path)) {
      console.error(`[fetch:danmaku] 找不到 ID 列表：${path}`)
      process.exit(1)
    }
    ids.push(...readFileSync(path, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(normalizeVideoId))
  }
  return [...new Set(ids)]
}

function readIds(source: DatasetSource): string[] {
  const direct = readDirectIds()
  if (direct)
    return direct
  const path = join(MISSING_DIR, `${source.id}.txt`)
  if (!existsSync(path))
    return []
  return readFileSync(path, 'utf8').split('\n').map(line => line.trim()).filter(Boolean)
}

/** 目录名以 `_<videoId>` 结尾；只建一次索引，供所有 dataset 共用。 */
function buildSessionIndex(): Map<string, string> {
  const map = new Map<string, string>()
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.'))
      continue
    const match = /_([A-Za-z0-9_-]{11})$/.exec(entry.name)
    if (match && !map.has(match[1]!))
      map.set(match[1]!, join(root, entry.name))
  }
  return map
}

const sessions = buildSessionIndex()

function packDate(source: DatasetSource, videoId: string): string | null {
  const path = join(APP_ROOT, source.datapackDir, `${videoId}.datapack.json`)
  if (!existsSync(path))
    return null
  try {
    const pack = JSON.parse(readFileSync(path, 'utf8')) as { video?: { startedAt?: string | null } }
    return pack.video?.startedAt?.slice(0, 10) ?? null
  }
  catch {
    return null
  }
}

function sessionDir(source: DatasetSource, videoId: string): string {
  const existing = sessions.get(videoId)
  if (existing)
    return existing
  const date = packDate(source, videoId) ?? 'unknown'
  return join(root, `${date}_${source.label}_${videoId}`)
}

async function runYtdlp(args: string[]): Promise<{ code: number, stderr: string }> {
  const proc = Bun.spawn(['yt-dlp', ...args], { cwd: APP_ROOT, stdout: 'pipe', stderr: 'pipe' })
  const stderrPromise = new Response(proc.stderr).text()
  await new Response(proc.stdout).text()
  const code = await proc.exited
  return { code, stderr: await stderrPromise }
}

interface Task { source: DatasetSource, videoId: string }

async function runPool<T>(items: T[], size: number, task: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    for (;;) {
      const item = items[cursor]
      cursor += 1
      if (item === undefined)
        return
      await task(item)
    }
  })
  await Promise.all(workers)
}

let allTasks: Task[] = []
for (const source of selected) {
  for (const videoId of readIds(source))
    allTasks.push({ source, videoId })
}

let shardIndex = 0
let shardTotal = 1
if (values.shard) {
  const match = /^(\d+)\/(\d+)$/.exec(values.shard.trim())
  shardIndex = Number(match?.[1])
  shardTotal = Number(match?.[2])
  if (!match || !Number.isInteger(shardIndex) || !Number.isInteger(shardTotal)
    || shardTotal < 1 || shardIndex < 1 || shardIndex > shardTotal) {
    console.error(`[fetch:danmaku] --shard 格式应为 i/n（1 <= i <= n），收到：${values.shard}`)
    process.exit(1)
  }
  allTasks = allTasks.filter((_, index) => index % shardTotal === shardIndex - 1)
}

const tasks = allTasks

if (values['dry-run']) {
  for (const task of tasks.slice(0, limit || tasks.length))
    console.log(`${task.source.id}\t${task.videoId}`)
  console.log(`[fetch:danmaku] 候选 ${tasks.length} 场（${selected.map(s => s.id).join(', ')}）${values.shard ? `，分片 ${shardIndex}/${shardTotal}` : ''}`)
  process.exit(0)
}

// cookie 默认每次运行重新导出到 ~/yt-cookies.txt，随后 InnerTube 与 yt-dlp 共用。
const resolvedCookies = await resolveCookies({
  cookie: values.cookie,
  cookies: values.cookies,
  envCookie: process.env.YT_COOKIE,
  browser: values['cookies-from-browser'],
  cachePath: values['cookie-cache'],
  disable: values['no-cookies'],
  url: tasks[0] ? `https://www.youtube.com/watch?v=${tasks[0].videoId}` : undefined,
  appRoot: APP_ROOT,
  log: line => console.log(`[fetch:danmaku] ${line}`),
})
if (resolvedCookies.source === 'cache' && resolvedCookies.jarPath)
  console.log(`[fetch:danmaku] cookie：复用缓存 ${resolvedCookies.jarPath}`)
else if (resolvedCookies.source === 'none' && resolvedCookies.note)
  console.log(`[fetch:danmaku] ${resolvedCookies.note}`)
const cookieArgs = ytdlpCookieArgs(resolvedCookies, { browser: values['cookies-from-browser'] })
const innerTubeCookie = resolvedCookies.header

let ok = 0
let skipped = 0
let unavailable = 0
let failed = 0
const failures: { dataset: string, videoId: string, error: string }[] = []
const todo = limit > 0 ? tasks.slice(0, limit) : tasks
const started = Date.now()

/** InnerTube 中断后 state 里仍有续页；这时即使 jsonl 存在也不算完成。 */
function replayIncomplete(session: string, videoId: string): boolean {
  const path = join(session, 'work', 'replay-state.json')
  if (!existsSync(path))
    return false
  try {
    const state = JSON.parse(readFileSync(path, 'utf8')) as {
      videoId?: string
      continuation?: string | null
      stopReason?: string | null
    }
    return state.videoId === videoId && Boolean(state.continuation) && state.stopReason !== 'done'
  }
  catch {
    return false
  }
}

/** yt-dlp 回退：下载 `live_chat` 字幕并归一化，再与实时采集合并。 */
async function collectWithYtdlp(videoId: string, danmakuDir: string): Promise<'done' | 'unavailable'> {
  const jsonlPath = join(danmakuDir, `danmaku_${videoId}.jsonl`)
  const rawPath = join(danmakuDir, `${videoId}.live_chat.json`)
  if (!existsSync(rawPath)) {
    const args = [
      ...cookieArgs,
      '--no-warnings',
      '--no-cache-dir',
      '--socket-timeout',
      '60',
      '--retries',
      '5',
      ...(forceIpv4 ? ['--force-ipv4'] : []),
      '--skip-download',
      '--write-subs',
      '--sub-langs',
      'live_chat',
      '-o',
      join(danmakuDir, '%(id)s.%(ext)s'),
      `https://www.youtube.com/watch?v=${videoId}`,
    ]
    const result = await runYtdlp(args)
    if (result.code !== 0) {
      const detail = result.stderr.split('\n').filter(Boolean).at(-1) ?? `yt-dlp exit ${result.code}`
      throw new Error(detail)
    }
  }

  if (!existsSync(rawPath))
    return 'unavailable'

  const normalized = await normalizeLiveChat(rawPath, jsonlPath, videoId)
  if (normalized.duplicates > 0)
    console.log(`[fetch:danmaku] ${videoId} 字幕内重复 ${normalized.duplicates} 条已按 rendererId 去重`)
  const livePath = join(danmakuDir, `danmaku_live_${videoId}.jsonl`)
  if (existsSync(livePath)) {
    try {
      const merged = mergeDanmakuFiles([jsonlPath, livePath], jsonlPath)
      console.log(`[fetch:danmaku] ${videoId} 合并实时采集：${merged.before} + ${merged.added} → ${merged.after}（重复 ${merged.duplicates}）`)
    }
    catch (error) {
      console.error(`[fetch:danmaku] ${videoId} 合并实时采集失败，保留回放：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (!values['keep-raw'])
    unlinkSync(rawPath)
  return 'done'
}

console.log(`[fetch:danmaku] ${todo.length} 场，并发 ${concurrency}，引擎 ${engine}，root=${root}${values.shard ? `，分片 ${shardIndex}/${shardTotal}` : ''}`)

await runPool(todo, concurrency, async ({ source, videoId }) => {
  const session = sessionDir(source, videoId)
  const danmakuDir = join(session, 'danmaku')
  const jsonlPath = join(danmakuDir, `danmaku_${videoId}.jsonl`)
  const unavailablePath = join(session, 'work', 'chat-unavailable.txt')

  if (!values.force && existsSync(jsonlPath) && !(engine !== 'yt-dlp' && replayIncomplete(session, videoId))) {
    skipped += 1
    return
  }
  if (!values.force && existsSync(unavailablePath)) {
    skipped += 1
    return
  }

  try {
    mkdirSync(danmakuDir, { recursive: true })
    mkdirSync(join(session, 'work'), { recursive: true })

    let done = false
    if (engine !== 'yt-dlp') {
      const result = await collectReplay({
        videoId,
        session,
        cookie: innerTubeCookie,
        pageDelayMs,
        maxPages,
        resume: !values.force && !values['no-resume'],
        log: line => console.log(`[fetch:danmaku] ${line}`),
      })
      if (result.status === 'done') {
        done = true
      }
      else if (result.status === 'partial') {
        throw new Error(`InnerTube 回放未完成（${result.total} 条，${result.error ?? '中断'}）；重跑会从断点续翻`)
      }
      else if (result.status === 'live') {
        throw new Error('直播尚未结束，实时采集请用 fetch:live-chat')
      }
      else if (result.status === 'failed' && engine === 'innertube') {
        throw new Error(result.error ?? 'InnerTube 回放失败')
      }
      else if (result.status === 'failed') {
        console.log(`[fetch:danmaku] ${videoId} InnerTube 失败（${result.error ?? 'unknown'}），回退 yt-dlp`)
      }
      else if (result.status === 'no-replay' && engine === 'auto') {
        console.log(`[fetch:danmaku] ${videoId} watch 页没有回放聊天，回退 yt-dlp`)
      }
    }

    if (!done) {
      if (engine === 'innertube') {
        // 显式指定 InnerTube 时不再回退 yt-dlp；没有回放就是没有。
        writeFileSync(unavailablePath, 'no live_chat replay\n', 'utf8')
        unavailable += 1
        return
      }
      const outcome = await collectWithYtdlp(videoId, danmakuDir)
      if (outcome === 'unavailable') {
        writeFileSync(unavailablePath, 'no live_chat replay\n', 'utf8')
        unavailable += 1
        return
      }
    }

    if (existsSync(unavailablePath))
      unlinkSync(unavailablePath)
    ok += 1
  }
  catch (error) {
    failed += 1
    const message = error instanceof Error ? error.message : String(error)
    failures.push({ dataset: source.id, videoId, error: message })
    console.error(`[fetch:danmaku] ${source.id}/${videoId} 失败：${message}`)
  }
  finally {
    const done = ok + skipped + unavailable + failed
    if (done % 10 === 0)
      console.log(`[fetch:danmaku] ${done}/${todo.length}  ok=${ok} skip=${skipped} no-replay=${unavailable} fail=${failed}`)
  }
})

if (failures.length > 0) {
  const failedBase = shardTotal > 1 ? `failed-${shardIndex}-of-${shardTotal}` : 'failed'
  writeFileSync(
    join(MISSING_DIR, `${failedBase}.json`),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), failures }, null, 2)}\n`,
    'utf8',
  )
  writeFileSync(
    join(MISSING_DIR, `${failedBase}.txt`),
    `${failures.map(failure => failure.videoId).join('\n')}\n`,
    'utf8',
  )
}

const seconds = ((Date.now() - started) / 1000).toFixed(0)
console.log(`[fetch:danmaku] 完成：新增 ${ok} / 跳过 ${skipped} / 无回放 ${unavailable} / 失败 ${failed}（${seconds}s）`)
if (failures.length > 0)
  console.log(`[fetch:danmaku] 失败清单：${join(MISSING_DIR, 'failed.json')}`)
