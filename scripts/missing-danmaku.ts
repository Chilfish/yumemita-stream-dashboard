#!/usr/bin/env bun
/**
 * 列出「有弹幕但本机没有原始弹幕」的场次，供 fetch:danmaku 使用。
 *
 *   bun scripts/missing-danmaku.ts --root "D:/projects/claude-messages/temp/youtube-live"
 *
 * 输出 `data/missing-danmaku/<dataset>.txt` 与 `index.json`。
 * 判定：datapack 仍是 v1、chat.total > 0，且归档里找不到 `danmaku_<videoId>.jsonl`。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(APP_ROOT, 'data')

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    dataset: { type: 'string', multiple: true },
    out: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})

const USAGE = `用法：bun scripts/missing-danmaku.ts --root <会话根目录> [选项]

列出有弹幕、但本机没有原始弹幕的场次。

选项：
  --root <目录>      原始会话根目录（默认 $STREAM_SESSION_ROOT）
  --dataset <id>     只处理指定 dataset，可重复
  --out <目录>       输出目录，默认 data/missing-danmaku
  -h, --help         显示本帮助`

if (values.help) {
  console.log(USAGE)
  process.exit(0)
}

const root = resolve(values.root ?? process.env.STREAM_SESSION_ROOT ?? '')
if (!root || !existsSync(root)) {
  console.error('[missing] 请用 --root 指定归档的会话根目录（或设置 STREAM_SESSION_ROOT）')
  process.exit(1)
}

const outDir = resolve(values.out ?? join(DATA, 'missing-danmaku'))
mkdirSync(outDir, { recursive: true })

const rawIds = new Set<string>()
const unavailableIds = new Set<string>()
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.'))
    continue
  const id = /_([A-Za-z0-9_-]{11})$/.exec(entry.name)?.[1]
  if (!id)
    continue
  if (existsSync(join(root, entry.name, 'work', 'chat-unavailable.txt')))
    unavailableIds.add(id)
  const danmaku = join(root, entry.name, 'danmaku')
  if (!existsSync(danmaku))
    continue
  for (const name of readdirSync(danmaku)) {
    const match = /^danmaku_(.+)\.jsonl$/.exec(name)
    if (match)
      rawIds.add(match[1]!)
  }
}

const config = JSON.parse(readFileSync(join(APP_ROOT, 'data-sources.json'), 'utf8')) as {
  datasets: { id: string, datapackDir: string }[]
}
const selected = values.dataset && values.dataset.length > 0
  ? config.datasets.filter(source => values.dataset!.includes(source.id))
  : config.datasets

const datasets: Record<string, string[]> = {}
const unavailableByDataset: Record<string, number> = {}
let total = 0
let rebuildMisses = 0
let noReplay = 0

for (const source of selected) {
  const dir = join(APP_ROOT, source.datapackDir)
  if (!existsSync(dir))
    continue
  const missing: string[] = []
  let unavailable = 0
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.datapack.json'))
      continue
    let pack: { schema?: string, chat?: { total?: number } }
    try {
      pack = JSON.parse(readFileSync(join(dir, name), 'utf8')) as { schema?: string, chat?: { total?: number } }
    }
    catch {
      continue
    }
    if (pack.schema === 'yumemita.stream-datapack/v2')
      continue
    if ((pack.chat?.total ?? 0) === 0)
      continue
    const videoId = name.replace(/\.datapack\.json$/, '')
    if (rawIds.has(videoId)) {
      rebuildMisses += 1
      continue
    }
    if (unavailableIds.has(videoId)) {
      unavailable += 1
      noReplay += 1
      continue
    }
    missing.push(videoId)
  }
  missing.sort()
  datasets[source.id] = missing
  unavailableByDataset[source.id] = unavailable
  total += missing.length
  writeFileSync(join(outDir, `${source.id}.txt`), `${missing.join('\n')}\n`, 'utf8')
  console.log(`${source.id}: ${missing.length}${unavailable > 0 ? `（另有 ${unavailable} 场确认无回放）` : ''}`)
}

writeFileSync(
  join(outDir, 'index.json'),
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    total,
    noReplay,
    datasets,
    unavailable: unavailableByDataset,
  }, null, 2)}\n`,
  'utf8',
)

console.log(`[missing] 待补 ${total} 场，确认无回放 ${noReplay} 场 -> ${outDir}`)
if (rebuildMisses > 0)
  console.log(`[missing] 另有 ${rebuildMisses} 场本机已有 jsonl 但仍是 v1，先跑 enrich:chat`)
