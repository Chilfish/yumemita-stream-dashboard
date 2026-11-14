#!/usr/bin/env bun
/**
 * 把频道专属表情镜像到本地暂存区 `data/<datasetId>/emoji/<hash>.png`。
 *
 *   bun run fetch:emoji --dataset yuno          # 只补缺失
 *   bun run fetch:emoji --dataset yuno --force  # 重抓全部
 *   bun run fetch:emoji --dataset yuno --dry-run
 *
 * 图片来源是 datapack 的 `chat.emojis[].url`（归一化时从原始回放的 emoji run 抓到的
 * `yt3.ggpht.com` 地址）；浏览器只读对象存储，不直连 YouTube。
 * 抓完由 `bun run publish:assets` 上传到 `<base>/emojis/<datasetId>/`。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { emojiFileName, emojiFolder } from '../src/lib/emoji.ts'
import { parseEmojiPicker } from './lib/emoji-picker.ts'
import { runPool } from './lib/object-storage.ts'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')
const PACK_SUFFIX = '.datapack.json'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
const TIMEOUT_MS = 15000
const RETRIES = 2
/** 表情原图约 3 KB；低于 200 字节基本是占位/错误响应。 */
const MIN_BYTES = 200

interface DatasetSource {
  id: string
  label: string
  datapackDir: string
}

interface PackEmoji {
  id?: string
  name?: string | null
  url?: string
}

interface Candidate {
  file: string
  emojiId: string
  name: string | null
  url: string
  /** `youtube` 或 dataset id；全局表情只存一份。 */
  folder: string
}

const EMOJI_INDEX_SCHEMA = 'yumemita.emoji-index/v1'

interface Counts {
  ok: number
  skipped: number
  failed: number
}

const OPTIONS = {
  dataset: { type: 'string' },
  limit: { type: 'string' },
  force: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  concurrency: { type: 'string', default: '4' },
  help: { type: 'boolean', short: 'h' },
} as const

const USAGE = `用法：bun scripts/fetch-emoji.ts [选项]

把频道表情镜像到 data/<datasetId>/emoji/<hash>.png，发布时由
bun run publish:assets 一起上传。来源：
  - data/emoji-<datasetId>.html：频道表情选择器的 HTML（不依赖任何一场的原始回放）
  - data/emoji-youtube.html：YouTube 全局表情选择器（UCksz… 前缀）
  - datapack 的 chat.emojis：重新归一化过的场次带上的图片地址
已存在的图片默认跳过；单张失败只记日志，不阻塞其余表情。

选项：
  --dataset <id>     只处理指定 dataset；不传则处理 data-sources.json 里的全部
  --limit <n>        本次每个 dataset 最多抓 n 张；0 = 全部
  --force            已存在的表情也重新下载
  --dry-run          只列出候选，不发请求、不写文件
  --concurrency <n>  并发数，默认 4
  -h, --help         显示本帮助

旧 pack 没有 chat.emojis 时，放一份频道表情字典（data/emoji-<datasetId>.html）
就能补全图片，不需要重抓历史弹幕。`

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 表情字典：频道自己的 picker HTML（`data/emoji-<datasetId>.html`，或放在 dataset 目录的
 * `emoji-picker.html`）+ YouTube 全局表情（`data/emoji-youtube.html`，id 前缀 UCksz…）。
 */
function dictionaryPaths(source: DatasetSource): string[] {
  return [
    join(APP_ROOT, 'data', `emoji-${source.id}.html`),
    join(resolve(APP_ROOT, source.datapackDir), 'emoji-picker.html'),
    join(APP_ROOT, 'data', 'emoji-youtube.html'),
  ].filter(path => existsSync(path))
}

/**
 * 一个 dataset 的去重表：同一张表情可能出现在几十场里。
 * 先读频道表情字典（不依赖任何一场的原始回放），再用 pack 里的 `chat.emojis` 补充。
 */
function collectCandidates(source: DatasetSource): Candidate[] {
  const dir = resolve(APP_ROOT, source.datapackDir)
  const seen = new Map<string, Candidate>()
  const add = (emojiId: string, url: string, name: string | null) => {
    const file = emojiFileName(emojiId)
    if (!file || seen.has(emojiId))
      return
    seen.set(emojiId, { file, emojiId, name, url, folder: emojiFolder(source.id, emojiId) })
  }

  for (const path of dictionaryPaths(source)) {
    for (const emoji of parseEmojiPicker(readFileSync(path, 'utf8')))
      add(emoji.id, emoji.url, emoji.name)
  }

  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(PACK_SUFFIX))
        continue
      let pack: { chat?: { emojis?: PackEmoji[] } }
      try {
        pack = JSON.parse(readFileSync(join(dir, name), 'utf8')) as typeof pack
      }
      catch {
        continue
      }
      for (const emoji of pack.chat?.emojis ?? []) {
        if (typeof emoji.id === 'string' && typeof emoji.url === 'string')
          add(emoji.id, emoji.url, emoji.name ?? null)
      }
    }
  }

  return [...seen.values()].sort((a, b) => a.emojiId.localeCompare(b.emojiId))
}

async function downloadEmoji(url: string): Promise<Uint8Array> {
  let lastMessage = '未知错误'
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    if (attempt > 0)
      await sleep(600 * attempt)

    let response: Response
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'image/png,image/*;q=0.8' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    }
    catch (error) {
      lastMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      continue
    }

    if (!response.ok) {
      lastMessage = `HTTP ${response.status}`
      if (response.status !== 429 && response.status < 500)
        throw new Error(lastMessage)
      continue
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
    if (!contentType.startsWith('image/'))
      throw new Error(`content-type 不是图片（${contentType || '空'}）`)

    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength < MIN_BYTES)
      throw new Error(`只有 ${bytes.byteLength} 字节，疑似占位图`)
    // 统一落成 PNG：页面按固定文件名 <hash>.png 取图。
    if (contentType === 'image/png')
      return bytes
    return new Uint8Array(await new Bun.Image(bytes).png().bytes())
  }
  throw new Error(lastMessage)
}

function writeAtomic(path: string, bytes: Uint8Array): void {
  const temp = `${path}.tmp`
  writeFileSync(temp, bytes)
  try {
    renameSync(temp, path)
  }
  finally {
    if (existsSync(temp))
      unlinkSync(temp)
  }
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`
}

/** 频道表情放 dataset 目录；YouTube 全局表情只存一份 `data/youtube/emoji/`。 */
function emojiDir(source: DatasetSource, folder: string): string {
  return folder === 'youtube'
    ? join(APP_ROOT, 'data', 'youtube', 'emoji')
    : join(resolve(APP_ROOT, source.datapackDir), 'emoji')
}

async function fetchDataset(
  source: DatasetSource,
  limit: number,
  concurrency: number,
  force: boolean,
  dryRun: boolean,
): Promise<Counts> {
  const outDir = join(resolve(APP_ROOT, source.datapackDir), 'emoji')
  const dictionaries = dictionaryPaths(source)
  if (dictionaries.length > 0)
    console.log(`[fetch-emoji] ${source.id}：表情字典 ${dictionaries.map(path => basename(path)).join(' + ')}`)
  const candidates = collectCandidates(source)
  if (candidates.length === 0) {
    console.log(`[fetch-emoji] ${source.id}：没有 chat.emojis，也没有 data/emoji-${source.id}.html`)
    return { ok: 0, skipped: 0, failed: 0 }
  }

  const existing = force ? [] : candidates.filter(item => existsSync(join(emojiDir(source, item.folder), item.file)))
  const known = new Set(existing.map(item => item.emojiId))
  const pendingAll = candidates.filter(item => !known.has(item.emojiId))
  const pending = limit > 0 ? pendingAll.slice(0, limit) : pendingAll
  const globalCount = candidates.filter(item => item.folder === 'youtube').length

  console.log(`[fetch-emoji] ${source.id}：${candidates.length} 个表情（YouTube 全局 ${globalCount} 个），已有 ${existing.length} 个，本次处理 ${pending.length} 个（并发 ${concurrency}）`)
  if (pendingAll.length > pending.length)
    console.log(`[fetch-emoji] ${source.id}：--limit ${limit} 只抓 ${pending.length} 个，其余 ${pendingAll.length - pending.length} 个留到下次`)

  if (dryRun) {
    for (const item of pending)
      console.log(`  emojis/${item.folder}/${item.file}  ←  ${item.emojiId}`)
    console.log(`[fetch-emoji] ${source.id}：成功 0 / 跳过 ${existing.length} / 失败 0`)
    return { ok: 0, skipped: existing.length, failed: 0 }
  }

  mkdirSync(outDir, { recursive: true })
  // 旧 pack 没有名称可读，页面靠这份 id → 名称索引渲染文字标签。
  const names = Object.fromEntries(
    candidates
      .filter(item => item.name)
      .map(item => [item.emojiId, item.name!]),
  )
  writeFileSync(
    join(outDir, 'index.json'),
    `${JSON.stringify({ schema: EMOJI_INDEX_SCHEMA, names }, null, 2)}\n`,
    'utf8',
  )

  for (const folder of new Set(pending.map(item => item.folder)))
    mkdirSync(emojiDir(source, folder), { recursive: true })

  const counts: Counts = { ok: 0, skipped: existing.length, failed: 0 }
  await runPool(pending, concurrency, async (item) => {
    try {
      const bytes = await downloadEmoji(item.url)
      writeAtomic(join(emojiDir(source, item.folder), item.file), bytes)
      counts.ok += 1
      console.log(`[fetch-emoji] ${item.folder}/${item.emojiId} 成功：${formatBytes(bytes.byteLength)}`)
    }
    catch (error) {
      counts.failed += 1
      console.warn(`[fetch-emoji] ${item.folder}/${item.emojiId} 失败：${describe(error)}`)
    }
  })

  console.log(`[fetch-emoji] ${source.id}：成功 ${counts.ok} / 跳过 ${counts.skipped} / 失败 ${counts.failed}`)
  return counts
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: OPTIONS, args: process.argv.slice(2), allowPositionals: false })
  if (values.help) {
    console.log(USAGE)
    return
  }

  const sources = readJson<{ datasets?: DatasetSource[] }>(CONFIG_PATH).datasets ?? []
  const selected = values.dataset ? sources.filter(item => item.id === values.dataset) : sources
  if (selected.length === 0) {
    console.error(`[fetch-emoji] 找不到 dataset：${values.dataset ?? '(请用 --dataset 指定)'}`)
    console.error(`[fetch-emoji] 可用：${sources.map(item => item.id).join(', ') || '(data-sources.json 为空)'}`)
    process.exit(1)
  }

  const limit = Number(values.limit ?? 0)
  const concurrency = Number(values.concurrency ?? 4)
  if (!Number.isInteger(limit) || limit < 0) {
    console.error('[fetch-emoji] --limit 需要是 >= 0 的整数')
    process.exit(1)
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    console.error('[fetch-emoji] --concurrency 需要是 >= 1 的整数')
    process.exit(1)
  }

  const total: Counts = { ok: 0, skipped: 0, failed: 0 }
  for (const source of selected) {
    const counts = await fetchDataset(source, limit, concurrency, Boolean(values.force), Boolean(values['dry-run']))
    total.ok += counts.ok
    total.skipped += counts.skipped
    total.failed += counts.failed
  }

  if (selected.length > 1 || total.failed > 0)
    console.log(`[fetch-emoji] 合计：成功 ${total.ok} / 跳过 ${total.skipped} / 失败 ${total.failed}`)
  if (total.ok > 0)
    console.log('[fetch-emoji] 下一步：bun run publish:assets 上传表情（emoji 先于 archive 上传）')
}

await main()
