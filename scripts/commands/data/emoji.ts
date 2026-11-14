/**
 * 把频道专属表情镜像到本地暂存区 `data/<datasetId>/emoji/<hash>.png`。
 *
 *   bun run ymmt data emoji --dataset yuno          # 只补缺失
 *   bun run ymmt data emoji --dataset yuno --force  # 重抓全部
 *   bun run ymmt data emoji --dataset yuno --dry-run
 *
 * 图片来源是 datapack 的 `chat.emojis[].url`（归一化时从原始回放的 emoji run 抓到的
 * `yt3.ggpht.com` 地址）；浏览器只读对象存储，不直连 YouTube。
 * 抓完由 `bun run ymmt publish data --assets-only` 上传到 `<base>/emojis/<datasetId>/`。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { Option } from 'commander'
import type { Logger } from '@scripts/lib/cli/logger.ts'
import type { CommandSpec } from '@scripts/lib/cli/runtime.ts'
import { CliError, UsageError } from '@scripts/lib/cli/exit.ts'
import { emojiFileName, emojiFolder } from '@/lib/emoji.ts'
import { parseEmojiPicker } from '@scripts/lib/emoji-picker.ts'
import { runPool } from '@scripts/lib/object-storage.ts'

const APP_ROOT = resolve(import.meta.dir, '../../..')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')
const PACK_SUFFIX = '.datapack.json'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
const TIMEOUT_MS = 15000
const RETRIES = 2
/** 表情原图约 3 KB；低于 200 字节基本是占位/错误响应。 */
const MIN_BYTES = 200
const DEFAULT_CONCURRENCY = 4

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

export interface EmojiCounts {
  ok: number
  skipped: number
  failed: number
}

/** 注入的日志器；默认静默，方便测试与进程内调用。 */
export type CommandLog = Pick<Logger, 'info' | 'warn' | 'error'>

const SILENT_LOG: CommandLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

export interface RunEmojiOptions {
  /** 只处理指定 dataset；不传则处理 data-sources.json 里的全部。 */
  dataset?: string
  /** 本次每个 dataset 最多抓 n 张；0 = 全部。 */
  limit?: number
  /** 已存在的表情也重新下载。 */
  force?: boolean
  /** 只列出候选，不发请求、不写文件。 */
  dryRun?: boolean
  /** 并发数，默认 4。 */
  concurrency?: number
  /** 注入的日志器；默认静默。 */
  log?: CommandLog
}

export interface EmojiRunResult {
  datasets: ({ id: string } & EmojiCounts)[]
  totals: EmojiCounts
}

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
  log: CommandLog,
): Promise<EmojiCounts> {
  const outDir = join(resolve(APP_ROOT, source.datapackDir), 'emoji')
  const dictionaries = dictionaryPaths(source)
  if (dictionaries.length > 0)
    log.info(`${source.id}：表情字典 ${dictionaries.map(path => basename(path)).join(' + ')}`)
  const candidates = collectCandidates(source)
  if (candidates.length === 0) {
    log.info(`${source.id}：没有 chat.emojis，也没有 data/emoji-${source.id}.html`)
    return { ok: 0, skipped: 0, failed: 0 }
  }

  const existing = force ? [] : candidates.filter(item => existsSync(join(emojiDir(source, item.folder), item.file)))
  const known = new Set(existing.map(item => item.emojiId))
  const pendingAll = candidates.filter(item => !known.has(item.emojiId))
  const pending = limit > 0 ? pendingAll.slice(0, limit) : pendingAll
  const globalCount = candidates.filter(item => item.folder === 'youtube').length

  log.info(`${source.id}：${candidates.length} 个表情（YouTube 全局 ${globalCount} 个），已有 ${existing.length} 个，本次处理 ${pending.length} 个（并发 ${concurrency}）`)
  if (pendingAll.length > pending.length)
    log.info(`${source.id}：--limit ${limit} 只抓 ${pending.length} 个，其余 ${pendingAll.length - pending.length} 个留到下次`)

  if (dryRun) {
    for (const item of pending)
      log.info(`  emojis/${item.folder}/${item.file}  ←  ${item.emojiId}`)
    log.info(`${source.id}：成功 0 / 跳过 ${existing.length} / 失败 0`)
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

  const counts: EmojiCounts = { ok: 0, skipped: existing.length, failed: 0 }
  await runPool(pending, concurrency, async (item) => {
    try {
      const bytes = await downloadEmoji(item.url)
      writeAtomic(join(emojiDir(source, item.folder), item.file), bytes)
      counts.ok += 1
      log.info(`${item.folder}/${item.emojiId} 成功：${formatBytes(bytes.byteLength)}`)
    }
    catch (error) {
      counts.failed += 1
      log.warn(`${item.folder}/${item.emojiId} 失败：${describe(error)}`)
    }
  })

  log.info(`${source.id}：成功 ${counts.ok} / 跳过 ${counts.skipped} / 失败 ${counts.failed}`)
  return counts
}

/**
 * 把频道 / 全局表情镜像到 `data/<datasetId>/emoji/`。
 *
 * 进程内可调用（`data update` 用它替代 spawn）：不读 process.argv、不调用 process.exit。
 * 进度走注入的 `log`；单张失败只记日志，不阻塞其余表情。
 */
export async function runEmoji(options: RunEmojiOptions = {}): Promise<{ exitCode: number, data?: EmojiRunResult }> {
  const log = options.log ?? SILENT_LOG
  const limit = options.limit ?? 0
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  if (!Number.isInteger(limit) || limit < 0) {
    throw new UsageError('--limit 需要是 >= 0 的整数', {
      hint: '例如 --limit 50，0 表示不限',
      context: { option: 'limit', value: limit },
    })
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new UsageError('--concurrency 需要是 >= 1 的整数', {
      hint: '例如 --concurrency 4',
      context: { option: 'concurrency', value: concurrency },
    })
  }

  const sources = readJson<{ datasets?: DatasetSource[] }>(CONFIG_PATH).datasets ?? []
  const selected = options.dataset ? sources.filter(item => item.id === options.dataset) : sources
  if (selected.length === 0) {
    throw new CliError(`找不到 dataset：${options.dataset ?? '(请用 --dataset 指定)'}`, {
      code: 'UNKNOWN_DATASET',
      hint: `可用：${sources.map(item => item.id).join(', ') || '(data-sources.json 为空)'}`,
      context: { dataset: options.dataset ?? null },
    })
  }

  const force = options.force === true
  const dryRun = options.dryRun === true

  const totals: EmojiCounts = { ok: 0, skipped: 0, failed: 0 }
  const datasets: EmojiRunResult['datasets'] = []
  for (const source of selected) {
    const counts = await fetchDataset(source, limit, concurrency, force, dryRun, log)
    datasets.push({ id: source.id, ...counts })
    totals.ok += counts.ok
    totals.skipped += counts.skipped
    totals.failed += counts.failed
  }

  if (selected.length > 1 || totals.failed > 0)
    log.info(`合计：成功 ${totals.ok} / 跳过 ${totals.skipped} / 失败 ${totals.failed}`)
  if (totals.ok > 0)
    log.info('下一步：bun run ymmt publish data --assets-only 上传表情（emoji 先于 archive 上传）')

  return { exitCode: totals.failed > 0 ? 1 : 0, data: { datasets, totals } }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** `data emoji`：镜像频道与 YouTube 全局表情。 */
export const dataEmojiSpec: CommandSpec<EmojiRunResult> = {
  id: 'data.emoji',
  description: '镜像频道与 YouTube 全局表情到本地暂存区',
  details: '把频道表情镜像到 data/<datasetId>/emoji/<hash>.png，发布时由 '
    + '`bun run ymmt publish data --assets-only` 一起上传。来源：\n'
    + '  - data/emoji-<datasetId>.html：频道表情选择器的 HTML（不依赖任何一场的原始回放）\n'
    + '  - data/emoji-youtube.html：YouTube 全局表情选择器（UCksz… 前缀）\n'
    + '  - datapack 的 chat.emojis：重新归一化过的场次带上的图片地址\n'
    + '已存在的图片默认跳过；单张失败只记日志，不阻塞其余表情。\n\n'
    + '旧 pack 没有 chat.emojis 时，放一份频道表情字典（data/emoji-<datasetId>.html）'
    + '就能补全图片，不需要重抓历史弹幕。',
  examples: [
    'bun run ymmt data emoji --dataset yuno',
    'bun run ymmt data emoji --dataset yuno --force',
    'bun run ymmt data emoji --dataset yuno --dry-run',
  ],
  options: [
    new Option('--dataset <id>', '只处理指定 dataset；不传则处理 data-sources.json 里的全部'),
    new Option('--limit <n>', '本次每个 dataset 最多抓 n 张；0 = 全部').default(0),
    new Option('--force', '已存在的表情也重新下载'),
    new Option('--concurrency <n>', `并发数，默认 ${DEFAULT_CONCURRENCY}`).default(DEFAULT_CONCURRENCY),
  ],
  async run(ctx) {
    const result = await runEmoji({
      dataset: optionalString(ctx.options.dataset),
      limit: ctx.integer('limit', 0, 0),
      concurrency: ctx.integer('concurrency', DEFAULT_CONCURRENCY, 1),
      force: ctx.flag('force'),
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    return { exitCode: result.exitCode, data: result.data }
  },
}
