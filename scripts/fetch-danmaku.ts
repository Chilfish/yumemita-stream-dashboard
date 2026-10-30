#!/usr/bin/env bun
/**
 * 只补缺失场次的弹幕回放（live_chat），不碰 meta / 评论 / VSTATS。
 *
 *   bun scripts/fetch-danmaku.ts --root "D:/projects/claude-messages/temp/youtube-live"
 *   bun scripts/fetch-danmaku.ts --dataset arale --limit 20 --concurrency 3
 *   bun scripts/fetch-danmaku.ts --dataset yuno --cookies-from-browser firefox
 *
 * 输入默认读 `data/missing-danmaku/<dataset>.txt`（由缺失清单生成）。
 * 已有 `danmaku_<videoId>.jsonl` 或 `work/chat-unavailable.txt` 的场次会跳过，可反复执行。
 *
 * 输出：
 *   <root>/<日期>_<成员>_<videoId>/danmaku/danmaku_<videoId>.jsonl
 *   <root>/<日期>_<成员>_<videoId>/work/chat-unavailable.txt   （没有弹幕回放时）
 *
 * 只下载 live_chat 字幕，成功后默认删掉原始 `.live_chat.json`；加 `--keep-raw` 保留。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { normalizeLiveChat } from './lib/live-chat.ts'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')
const MISSING_DIR = join(APP_ROOT, 'data', 'missing-danmaku')

interface DatasetSource {
  id: string
  label: string
  datapackDir: string
}

const { values } = parseArgs({
  options: {
    dataset: { type: 'string', multiple: true },
    root: { type: 'string' },
    ids: { type: 'string' },
    concurrency: { type: 'string', default: '3' },
    limit: { type: 'string', default: '0' },
    shard: { type: 'string' },
    force: { type: 'boolean' },
    'keep-raw': { type: 'boolean' },
    cookies: { type: 'string' },
    'cookies-from-browser': { type: 'string', default: 'firefox' },
    'no-force-ipv4': { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})

const USAGE = `用法：bun scripts/fetch-danmaku.ts --root <会话根目录> [选项]

只抓缺失场次的 live_chat 弹幕回放，不重新抓 meta / 评论 / VSTATS。

选项：
  --dataset <id>             只处理指定 dataset，可重复；默认读 data/missing-danmaku/ 下全部
  --root <目录>              原始会话根目录（默认 $STREAM_SESSION_ROOT）
  --ids <文件>               直接读 videoId 列表（每行一个），需同时指定一个 --dataset
  --concurrency <n>          并发，默认 3
  --limit <n>                本次最多处理 n 场，0 = 全部
  --shard <i/n>              多实例分片：只处理第 i 片（1 起），例如 1/4、2/4
  --force                    已有 jsonl 也重抓
  --keep-raw                 保留原始 .live_chat.json
  --cookies <文件>           Netscape cookie jar；不传则用 --cookies-from-browser
  --cookies-from-browser <b> 默认 firefox
  --no-force-ipv4            不强制 IPv4
  --dry-run                  只列出候选
  -h, --help                 显示本帮助

没有配置任何 cookie 来源时，会员限定场次可能失败；失败会打印并保留在清单里，下次重跑。`

if (values.help) {
  console.log(USAGE)
  process.exit(0)
}

const root = resolve(values.root ?? process.env.STREAM_SESSION_ROOT ?? '')
if (!root || !existsSync(root)) {
  console.error('[fetch:danmaku] 请用 --root 指定归档的会话根目录（或设置 STREAM_SESSION_ROOT）')
  process.exit(1)
}

const concurrency = Math.max(1, Number(values.concurrency) || 3)
const limit = Math.max(0, Number(values.limit) || 0)
const forceIpv4 = !values['no-force-ipv4']
const cookieArgs = values.cookies
  ? ['--cookies', resolve(values.cookies)]
  : ['--cookies-from-browser', values['cookies-from-browser'] ?? 'firefox']

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

if (values.ids && selected.length !== 1) {
  console.error('[fetch:danmaku] 用 --ids 时请同时指定且只指定一个 --dataset，避免把 ID 写进错误的成员目录')
  process.exit(1)
}

function readIds(source: DatasetSource): string[] {
  if (values.ids)
    return readFileSync(resolve(values.ids), 'utf8').split('\n').map(line => line.trim()).filter(Boolean)
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

let ok = 0
let skipped = 0
let unavailable = 0
let failed = 0
const failures: { dataset: string, videoId: string, error: string }[] = []
const todo = limit > 0 ? tasks.slice(0, limit) : tasks
const started = Date.now()

console.log(`[fetch:danmaku] ${todo.length} 场，并发 ${concurrency}，root=${root}${values.shard ? `，分片 ${shardIndex}/${shardTotal}` : ''}`)

await runPool(todo, concurrency, async ({ source, videoId }) => {
  const session = sessionDir(source, videoId)
  const danmakuDir = join(session, 'danmaku')
  const jsonlPath = join(danmakuDir, `danmaku_${videoId}.jsonl`)
  const unavailablePath = join(session, 'work', 'chat-unavailable.txt')

  if (!values.force && existsSync(jsonlPath)) {
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

    if (!existsSync(rawPath)) {
      writeFileSync(unavailablePath, 'no live_chat replay\n', 'utf8')
      unavailable += 1
      return
    }

    await normalizeLiveChat(rawPath, jsonlPath, videoId)
    if (!values['keep-raw'])
      unlinkSync(rawPath)
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
