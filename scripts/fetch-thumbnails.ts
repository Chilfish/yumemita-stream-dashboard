#!/usr/bin/env bun
/**
 * 补齐封面图：把 YouTube 的 16:9 封面镜像到本地暂存区 `data/<datasetId>/thumbs/<videoId>.jpg`。
 *
 *   bun run fetch:thumbs --dataset nonoka            # 只补缺失
 *   bun run fetch:thumbs --dataset nonoka --force    # 重抓全部
 *   bun run fetch:thumbs --dataset nonoka --limit 20 --dry-run
 *
 * 页面运行时只读对象存储（`<base>/<datasetId>/thumbs/<videoId>.jpg`），不直连 YouTube：
 * 避免热链、CORS 与慢请求拖慢首屏。抓完由 `bun run publish:data` 上传。
 *
 * 特性：
 *   - 可重入：已存在的 jpg 默认跳过，`--force` 才重抓
 *   - 选图：maxresdefault（1280×720）→ mqdefault（320×180），两个都是真 16:9；
 *     不用 hqdefault / sddefault，它们是 4:3 letterbox，进页面会出现黑边
 *   - 校验：response.ok、content-type 是 image/*、字节数 > 1500（YouTube 偶尔回小占位图）
 *   - 15 秒超时、2 次重试、默认并发 4；单张失败只记日志，不阻塞其余场次
 *   - 原子写入：先写 `.tmp` 再 rename，中断不会留下半张图被下次当成“已有”
 *   - 变体：每张原图用 `Bun.Image` 编码成 480 / 960 / 1280w 的 WebP（quality 78），
 *     key 见 `src/lib/thumb-variants.ts`；只有原图时自动补齐，不重新下载
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { THUMB_VARIANTS, thumbVariantName } from '../src/lib/thumb-variants.ts'
import { runPool } from './lib/object-storage.ts'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')
const THUMB_HOST = 'https://i.ytimg.com/vi'
const PACK_SUFFIX = '.datapack.json'

/** 顺序即优先级：先大后小，两个都是真 16:9。 */
const VARIANTS = ['maxresdefault.jpg', 'mqdefault.jpg']
/** 低于这个字节数基本是 YouTube 回的空占位图，不是封面。 */
const MIN_BYTES = 1500
const TIMEOUT_MS = 15000
const RETRIES = 2
/** WebP 质量：78 在 480w ≈ 20 KB、960w ≈ 42 KB、1280w ≈ 56 KB，肉眼看不出与原图的差别。 */
const WEBP_QUALITY = 78
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

interface DatasetSource {
  id: string
  label: string
  channelId?: string
  manifest?: string
  datapackDir: string
}

interface Downloaded {
  bytes: Uint8Array
  variant: string
}

interface Counts {
  ok: number
  skipped: number
  failed: number
  /** 本次写出的 WebP 变体数（含补旧图的部分）。 */
  variants: number
}

const OPTIONS = {
  dataset: { type: 'string' },
  limit: { type: 'string' },
  force: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  concurrency: { type: 'string', default: '4' },
  help: { type: 'boolean', short: 'h' },
} as const

const USAGE = `用法：bun scripts/fetch-thumbnails.ts [选项]

把每场直播的 YouTube 封面镜像到 data/<datasetId>/thumbs/<videoId>.jpg，
并编码 480 / 960 / 1280w 的 WebP 变体（<videoId>.<width>.webp），
发布时由 bun run publish:data 一起上传。已存在的原图默认跳过，只有原图时补变体；
单张失败只记日志，不阻塞其余场次。

选项：
  --dataset <id>     只处理指定 dataset；不传则处理 data-sources.json 里的全部
  --limit <n>        本次最多抓 n 张（按 manifest 顺序，最新的优先）；0 = 全部
  --force            已存在的封面也重新下载
  --dry-run          只列出候选，不发请求、不写文件
  --concurrency <n>  并发数，默认 4（太高会被 YouTube 限流）
  -h, --help         显示本帮助

选图顺序：maxresdefault.jpg（1280×720）→ mqdefault.jpg（320×180），都是真 16:9。
校验：content-type 为 image/*、字节数 > 1500；15 秒超时、失败重试 2 次。`

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 取一个尺寸。4xx 与校验不通过都直接抛（换下一个尺寸），只有超时/网络/5xx 才重试。 */
async function fetchVariant(url: string): Promise<Uint8Array> {
  let lastMessage = '未知错误'
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    if (attempt > 0)
      await sleep(600 * attempt)

    let response: Response
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
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
    if (bytes.byteLength <= MIN_BYTES)
      throw new Error(`只有 ${bytes.byteLength} 字节，疑似占位图`)
    return bytes
  }
  throw new Error(lastMessage)
}

async function downloadThumb(videoId: string): Promise<Downloaded> {
  const failures: string[] = []
  for (const variant of VARIANTS) {
    try {
      return { bytes: await fetchVariant(`${THUMB_HOST}/${videoId}/${variant}`), variant }
    }
    catch (error) {
      failures.push(`${variant}: ${describe(error)}`)
    }
  }
  throw new Error(failures.join('；'))
}

function writeAtomic(path: string, bytes: Uint8Array): void {
  const temp = `${path}.tmp`
  writeFileSync(temp, bytes)
  try {
    renameSync(temp, path)
  }
  finally {
    // rename 成功后 temp 已不存在；失败时清掉半成品，别让下次把它当成“已有”。
    if (existsSync(temp))
      unlinkSync(temp)
  }
}

function variantPath(thumbsDir: string, videoId: string, width: number): string {
  return join(thumbsDir, thumbVariantName(videoId, width))
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

/**
 * 由本地原图编码 WebP 变体。`srcset` 里每个宽度都必须有对象，
 * 所以源图更窄（mqdefault 320w）时也照样写出，避免候选 404 把封面顶成兜底面板。
 */
async function encodeVariants(jpgPath: string, thumbsDir: string, videoId: string, force: boolean): Promise<number> {
  const targets = THUMB_VARIANTS
    .map(width => ({ width, path: variantPath(thumbsDir, videoId, width) }))
    .filter(target => force || !existsSync(target.path))
  if (targets.length === 0)
    return 0

  const image = new Bun.Image(new Uint8Array(await Bun.file(jpgPath).arrayBuffer()))
  for (const target of targets) {
    const bytes = await image.resize(target.width).webp({ quality: WEBP_QUALITY }).bytes()
    writeAtomic(target.path, bytes)
  }
  return targets.length
}

/** manifest 的顺序就是「最新在前」，--limit 优先补最近的场次。 */
function videoIdsFor(source: DatasetSource, dir: string): string[] {
  const manifestPath = resolve(APP_ROOT, source.manifest ?? join(source.datapackDir, 'manifest.json'))
  if (existsSync(manifestPath)) {
    try {
      const manifest = readJson<{ streams?: { videoId?: string }[] }>(manifestPath)
      const ids = [...new Set((manifest.streams ?? [])
        .map(stream => stream.videoId)
        .filter((id): id is string => Boolean(id)))]
      if (ids.length > 0)
        return ids
    }
    catch (error) {
      console.warn(`[fetch-thumbs] ${source.id} manifest 读取失败，改用 datapack 文件名：${describe(error)}`)
    }
  }
  if (!existsSync(dir))
    return []
  return readdirSync(dir)
    .filter(name => name.endsWith(PACK_SUFFIX))
    .map(name => name.slice(0, -PACK_SUFFIX.length))
    .sort()
}

async function fetchDataset(source: DatasetSource, limit: number, concurrency: number, force: boolean, dryRun: boolean): Promise<Counts> {
  const dir = resolve(APP_ROOT, source.datapackDir)
  const thumbsDir = join(dir, 'thumbs')
  const ids = videoIdsFor(source, dir)
  if (ids.length === 0) {
    console.error(`[fetch-thumbs] ${source.id} 没有可用场次：${source.datapackDir}/ 里既没有 manifest.json，也没有 *${PACK_SUFFIX}`)
    process.exitCode = 1
    return { ok: 0, skipped: 0, failed: 0, variants: 0 }
  }

  const existing = force ? [] : ids.filter(id => existsSync(join(thumbsDir, `${id}.jpg`)))
  const known = new Set(existing)
  const pendingAll = ids.filter(id => !known.has(id))
  const pending = limit > 0 ? pendingAll.slice(0, limit) : pendingAll

  console.log(`[fetch-thumbs] ${source.id}：${ids.length} 场，已有 ${existing.length} 张，本次处理 ${pending.length} 张（并发 ${concurrency}）`)
  if (pendingAll.length > pending.length)
    console.log(`[fetch-thumbs] ${source.id}：--limit ${limit} 只抓 ${pending.length} 张，其余 ${pendingAll.length - pending.length} 张留到下次`)

  if (dryRun) {
    console.log(`[fetch-thumbs] ${source.id}：dry-run 只列候选，不发请求`)
    for (const id of pending)
      console.log(`  ${source.id}/thumbs/${id}.jpg  ←  ${THUMB_HOST}/${id}/maxresdefault.jpg`)
    console.log(`[fetch-thumbs] ${source.id}：成功 0 / 跳过 ${existing.length} / 失败 0`)
    return { ok: 0, skipped: existing.length, failed: 0, variants: 0 }
  }

  const counts: Counts = { ok: 0, skipped: existing.length, failed: 0, variants: 0 }

  // 老数据只有原图：就地补 WebP 变体，不重新下载。
  const backfill = force
    ? []
    : existing.filter(id => THUMB_VARIANTS.some(width => !existsSync(variantPath(thumbsDir, id, width))))
  if (backfill.length > 0) {
    console.log(`[fetch-thumbs] ${source.id}：${backfill.length} 张原图缺 WebP 变体，开始补齐...`)
    await runPool(backfill, concurrency, async (id) => {
      try {
        counts.variants += await encodeVariants(join(thumbsDir, `${id}.jpg`), thumbsDir, id, false)
      }
      catch (error) {
        counts.failed += 1
        console.warn(`[fetch-thumbs] ${source.id}/${id} 变体生成失败：${describe(error)}`)
      }
    })
  }

  if (pending.length > 0)
    mkdirSync(thumbsDir, { recursive: true })

  await runPool(pending, concurrency, async (id) => {
    try {
      const { bytes, variant } = await downloadThumb(id)
      const jpgPath = join(thumbsDir, `${id}.jpg`)
      writeAtomic(jpgPath, bytes)
      const written = await encodeVariants(jpgPath, thumbsDir, id, force)
      counts.ok += 1
      counts.variants += written
      console.log(`[fetch-thumbs] ${source.id}/${id} 成功：${variant}，${formatBytes(bytes.byteLength)}，变体 ${written} 个`)
    }
    catch (error) {
      counts.failed += 1
      console.warn(`[fetch-thumbs] ${source.id}/${id} 失败：${describe(error)}`)
    }
  })

  console.log(`[fetch-thumbs] ${source.id}：成功 ${counts.ok} / 跳过 ${counts.skipped} / 失败 ${counts.failed} / 变体 ${counts.variants}`)
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
    console.error(`[fetch-thumbs] 找不到 dataset：${values.dataset ?? '(请用 --dataset 指定)'}`)
    console.error(`[fetch-thumbs] 可用：${sources.map(item => item.id).join(', ') || '(data-sources.json 为空)'}`)
    process.exit(1)
  }

  const limit = Number(values.limit ?? 0)
  const concurrency = Number(values.concurrency ?? 4)
  if (!Number.isInteger(limit) || limit < 0) {
    console.error('[fetch-thumbs] --limit 需要是 >= 0 的整数')
    process.exit(1)
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    console.error('[fetch-thumbs] --concurrency 需要是 >= 1 的整数')
    process.exit(1)
  }

  const total: Counts = { ok: 0, skipped: 0, failed: 0, variants: 0 }
  for (const source of selected) {
    const counts = await fetchDataset(source, limit, concurrency, Boolean(values.force), Boolean(values['dry-run']))
    total.ok += counts.ok
    total.skipped += counts.skipped
    total.failed += counts.failed
    total.variants += counts.variants
  }

  if (selected.length > 1 || total.failed > 0)
    console.log(`[fetch-thumbs] 合计：成功 ${total.ok} / 跳过 ${total.skipped} / 失败 ${total.failed} / 变体 ${total.variants}`)
  if (total.ok > 0 || total.variants > 0)
    console.log('[fetch-thumbs] 下一步：bun run publish:data 上传封面与变体（thumbs 先于 pack 上传）')
}

await main()
