#!/usr/bin/env bun
/**
 * 给旧版 `danmaku_<videoId>.jsonl` 回填 `authorId`。
 *
 *   bun scripts/backfill-author-id.ts --root "D:/projects/claude-messages/temp/youtube-live"
 *
 * 旧 jsonl 是归档工程早期归一化的，没有 `msg.authorId`；原始 `live_chat.json`
 * 还在，重新归一化一遍即可补上。已有 authorId 的文件默认跳过，可反复执行。
 *
 * 产物仍然是 `<会话目录>/danmaku/danmaku_<videoId>.jsonl`，原始
 * `<videoId>.live_chat.json` 保留不动；写入用临时文件 + rename，失败不会留半成品。
 */
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { normalizeLiveChat } from './lib/live-chat.ts'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    concurrency: { type: 'string', default: '6' },
    limit: { type: 'string', default: '0' },
    force: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})

const USAGE = `用法：bun scripts/backfill-author-id.ts --root <会话根目录> [选项]

用原始 live_chat.json 重新归一化旧 jsonl，补上 msg.authorId。

选项：
  --root <目录>      归档的会话根目录（默认 $STREAM_SESSION_ROOT）
  --concurrency <n>  并发，默认 6
  --limit <n>        本次最多处理 n 个文件，0 = 全部
  --force            已有 authorId 也重新归一化
  --dry-run          只列出候选，不写文件
  -h, --help         显示本帮助`

if (values.help) {
  console.log(USAGE)
  process.exit(0)
}

const root = resolve(values.root ?? process.env.STREAM_SESSION_ROOT ?? '')
if (!root || !existsSync(root)) {
  console.error('[backfill] 请用 --root 指定归档的会话根目录（或设置 STREAM_SESSION_ROOT）')
  process.exit(1)
}

const concurrency = Math.max(1, Number(values.concurrency) || 6)
const limit = Math.max(0, Number(values.limit) || 0)

interface Target { id: string, raw: string, jsonl: string }

/** 只看前 64KB：旧文件完全没有 authorId，新文件每条都有，不用扫全量。 */
function hasAuthorId(path: string): boolean {
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(64 * 1024)
    const bytes = readSync(fd, buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytes).toString('utf8').includes('"authorId"')
  }
  finally {
    closeSync(fd)
  }
}

function countLines(path: string): number {
  const text = readFileSync(path, 'utf8')
  let count = 0
  for (const line of text.split('\n')) {
    if (line.trim())
      count += 1
  }
  return count
}

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

const targets: Target[] = []
let already = 0
let noRaw = 0

for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.'))
    continue
  const danmaku = join(root, entry.name, 'danmaku')
  if (!existsSync(danmaku))
    continue
  for (const name of readdirSync(danmaku)) {
    if (!name.startsWith('danmaku_') || !name.endsWith('.jsonl'))
      continue
    const id = name.slice('danmaku_'.length, -'.jsonl'.length)
    const jsonl = join(danmaku, name)
    if (!values.force && hasAuthorId(jsonl)) {
      already += 1
      continue
    }
    const raw = join(danmaku, `${id}.live_chat.json`)
    if (!existsSync(raw)) {
      noRaw += 1
      continue
    }
    targets.push({ id, raw, jsonl })
  }
}

const todo = limit > 0 ? targets.slice(0, limit) : targets
console.log(`[backfill] 候选 ${targets.length}，本次 ${todo.length}，已有 authorId ${already}，缺原始回放 ${noRaw}，并发 ${concurrency}`)

if (values['dry-run']) {
  for (const target of todo.slice(0, 20))
    console.log(`  ${target.id}`)
  if (todo.length > 20)
    console.log(`  ... 其余 ${todo.length - 20} 个`)
  process.exit(0)
}

let ok = 0
let failed = 0
let changed = 0
let lineDelta = 0
const failures: { id: string, error: string }[] = []
const started = Date.now()

await runPool(todo, concurrency, async ({ id, raw, jsonl }) => {
  const temp = `${jsonl}.authorid.tmp`
  try {
    const before = countLines(jsonl)
    await normalizeLiveChat(raw, temp, id)
    const after = countLines(temp)
    if (after === 0)
      throw new Error('归一化结果为空')
    if (before !== after) {
      changed += 1
      lineDelta += after - before
      if (Math.abs(after - before) > Math.max(10, before * 0.05))
        console.warn(`[backfill] ${id} 条数变化较大：${before} -> ${after}`)
    }
    if (existsSync(jsonl))
      unlinkSync(jsonl)
    renameSync(temp, jsonl)
    ok += 1
  }
  catch (error) {
    failed += 1
    const message = error instanceof Error ? error.message : String(error)
    failures.push({ id, error: message })
    console.error(`[backfill] ${id} 失败：${message}`)
    try {
      if (existsSync(temp))
        unlinkSync(temp)
    }
    catch {}
  }
  finally {
    const done = ok + failed
    if (done % 50 === 0)
      console.log(`[backfill] ${done}/${todo.length} ok=${ok} fail=${failed} ${((Date.now() - started) / 1000).toFixed(0)}s`)
  }
})

console.log(`[backfill] 完成：成功 ${ok} / 失败 ${failed} / 条数变化 ${changed}（净 ${lineDelta}）用时 ${((Date.now() - started) / 1000).toFixed(0)}s`)
if (failures.length > 0) {
  const path = join(APP_ROOT, 'data', 'missing-danmaku', 'backfill-failed.json')
  writeFileSync(path, `${JSON.stringify({ generatedAt: new Date().toISOString(), failures }, null, 2)}\n`, 'utf8')
  console.log(`[backfill] 失败清单：${path}`)
}
