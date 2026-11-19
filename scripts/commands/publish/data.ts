/**
 * 发布数据到对象存储（Cloudflare R2 等）。
 *
 *   bun run ymmt publish data              # 生成并增量上传
 *   bun run ymmt publish data --no-upload  # 只生成本地文件
 *   bun run ymmt publish data --dataset nonoka
 *   bun run ymmt publish data --force      # 忽略进度，全量重传
 *
 * 本地 `data/<id>/*.datapack.json` 是**唯一真源**：
 * 1. 由 pack 派生 manifest（摘要索引）与 insights（预聚合），写回本地供恢复与调试；
 * 2. 页面改由 PostgreSQL 查询，对象存储只保留不可变资产：封面 / 表情 / archive / 逐字稿；
 * 3. thumbs → archive 的顺序上传，先有图再引用；
 * 4. 增量上传：内容摘要记在 `data/.publish-state.json`，未变化且远端对得上的对象跳过。
 *
 * 封面图（`data/<id>/thumbs/<videoId>.jpg`）与 480 / 960 / 1280w 的 WebP 变体
 * （`<videoId>.<width>.webp`）由 `bun run ymmt data thumbnails` 生成，一起上传到
 * `<base>/<id>/thumbs/`；原始 pack 归档到 `archive/<id>/<videoId>.datapack.json`。
 *
 * `--assets-only` 只上传资产与 archive，不写任何 JSON 索引（manifest / insights /
 * group-* / index）。每日增量走这个模式；全量重建时才需要默认模式。
 *
 * 业务主体在 `runPublishData`：其它脚本（daily-update 等）直接 import 它，参数就是一个
 * 普通对象，不需要经过 CLI。`publishDataSpec` 只负责把 `ctx` 翻译成那份参数。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Option } from 'commander'
import { aggregateDataset, buildStreamRows } from '@/lib/aggregate.ts'
import { buildAuthorIndex } from '@/lib/author-index.ts'
import { THUMB_VARIANTS } from '@/lib/thumb-variants.ts'
import type { StreamDatapack } from '@/types/datapack.ts'
import type { BatchManifest } from '@/types/dataset.ts'
import { type CommandSpec, CliError, type Logger } from '@chilfish/devkit/cli'
import { INDEX_KEY, buildDatasetIndex } from '@scripts/lib/dataset-index.ts'
import type { DatasetIndex, DatasetIndexSource } from '@scripts/lib/dataset-index.ts'
import { buildStreamSummary, isoJst } from '@scripts/lib/dataset-manifest.ts'
import { buildGroupGallery, buildGroupSummary } from '@scripts/lib/group-summary.ts'
import {
  INSIGHTS_SCHEMA,
  MANIFEST_SCHEMA,
  archiveKey,
  authorsKey,
  createObjectStore,
  emojiKey,
  groupGalleryKey,
  groupSummaryKey,
  insightsKey,
  manifestKey,
  publishTarget,
  readCredentials,
  remoteBase,
  runPool,
  thumbVariantKey,
  thumbsKey,
} from '@scripts/lib/object-storage.ts'
import {
  digestBody,
  digestBytes,
  isUnchanged,
  publishStatePath,
  readPublishState,
  writePublishState,
} from '@scripts/lib/publish-state.ts'

interface DatasetSource {
  id: string
  label: string
  color?: string | null
  avatar?: string | null
  channelId?: string | null
  datapackDir: string
  subject?: string
  scope?: string
  note?: string
}

const APP_ROOT = resolve(import.meta.dir, '../../..')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')

const THUMB_SUFFIX = '.jpg'
const VARIANT_PATTERN = /^(.+)\.(\d+)\.webp$/
const GLOBAL_EMOJI_DIR = join(APP_ROOT, 'data', 'youtube', 'emoji')

/** 默认日志器：不注入 `log` 时整条命令静默，只返回结果。 */
const silentLog: Logger = {
  name: 'publish.data',
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  line: () => {},
  output: () => {},
  child: () => silentLog,
}

interface ThumbUpload {
  key: string
  body: Uint8Array
  contentType: string
}

interface ThumbCollection {
  uploads: ThumbUpload[]
  /** 本地已有的 videoId，用来核对 manifest 的 thumbnail 有没有落空。 */
  present: Set<string>
  /** 缺 WebP 变体的 videoId：页面 `srcset` 会退回原图，提示重跑 thumbnails。 */
  missingVariants: string[]
}

/** `runPublishData` 的入参：CLI 里每个 flag 的 camelCase 镜像。 */
export interface PublishDataOptions {
  /** `--dataset`：只发布指定 dataset。 */
  dataset?: string
  /** `--ids`：只上传文件里列出的 videoId（每行一个）；索引仍会刷新。 */
  ids?: string
  /** `--no-upload`：只生成本地文件，不上传。 */
  noUpload?: boolean
  /** `--assets-only`：只上传封面 / 表情 / archive，不写 JSON 索引。 */
  assetsOnly?: boolean
  /** `--force`：忽略 `data/.publish-state.json` 的进度，全量重传。 */
  force?: boolean
  /** `--adopt-remote`：本地没有进度记录时按远端大小对齐。 */
  adoptRemote?: boolean
  /** `--allow-shrink`：允许本地场次少于远端。 */
  allowShrink?: boolean
  /** `--dry-run`：只读，不写本地文件 / 对象存储 / 发布进度。 */
  dryRun?: boolean
  /** 进度日志；默认静默。 */
  log?: Logger
}

export interface PublishDataResult {
  exitCode: number
  data?: unknown
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function readPacks(source: DatasetSource, hasDatasetFilter: boolean, log: Logger): StreamDatapack[] | null {
  const dir = resolve(APP_ROOT, source.datapackDir)
  let files: string[]
  try {
    files = readdirSync(dir).filter(name => name.endsWith('.datapack.json'))
  }
  catch {
    if (hasDatasetFilter)
      throw new CliError(`找不到暂存目录：${dir}`, {
        hint: '先抓取或从备份恢复：bun run ymmt data fetch --dataset ' + source.id,
      })
    log.warn(`  ! ${source.id} 找不到暂存目录 ${source.datapackDir}/，跳过`)
    return null
  }
  if (files.length === 0) {
    if (hasDatasetFilter)
      throw new CliError(`${source.id} 在 ${source.datapackDir}/ 里没有 datapack`, {
        hint: '先运行抓取或从备份恢复：bun run ymmt data fetch --dataset ' + source.id,
      })
    log.warn(`  ! ${source.id} 还没有 datapack，跳过`)
    return null
  }

  return files.map((name) => {
    const pack = readJson<StreamDatapack>(join(dir, name))
    const expected = name.replace(/\.datapack\.json$/, '')
    if (pack.video?.id !== expected)
      throw new CliError(`${name} 的 video.id 与文件名不一致（${pack.video?.id ?? '缺失'}）`, {
        hint: `检查 ${join(dir, name)} 的 video.id，或删掉这份坏 pack 后重抓`,
      })
    return pack
  })
}

/**
 * 本地 `data/<id>/thumbs/<videoId>.jpg` 与 `<videoId>.<width>.webp` → 上传项。
 * 文件是谁生成的不要紧，key 由 dataset + videoId（+ 变体宽度）决定。
 */
function collectThumbs(source: DatasetSource, onlyIds?: ReadonlySet<string>): ThumbCollection {
  const dir = join(resolve(APP_ROOT, source.datapackDir), 'thumbs')
  const uploads: ThumbUpload[] = []
  const present = new Set<string>()
  const variantCounts = new Map<string, number>()
  if (!existsSync(dir))
    return { uploads, present, missingVariants: [] }

  for (const name of readdirSync(dir)) {
    if (name.endsWith(THUMB_SUFFIX)) {
      const videoId = name.slice(0, -THUMB_SUFFIX.length)
      if (onlyIds && !onlyIds.has(videoId))
        continue
      present.add(videoId)
      uploads.push({
        key: thumbsKey(source.id, videoId),
        body: readFileSync(join(dir, name)),
        contentType: 'image/jpeg',
      })
      continue
    }

    const match = VARIANT_PATTERN.exec(name)
    if (!match)
      continue
    const [, videoId, rawWidth] = match
    const width = Number(rawWidth)
    if (!videoId || !(THUMB_VARIANTS as readonly number[]).includes(width))
      continue
    if (onlyIds && !onlyIds.has(videoId))
      continue
    uploads.push({
      key: thumbVariantKey(source.id, videoId, width),
      body: readFileSync(join(dir, name)),
      contentType: 'image/webp',
    })
    variantCounts.set(videoId, (variantCounts.get(videoId) ?? 0) + 1)
  }

  const missingVariants = [...present]
    .filter(videoId => (variantCounts.get(videoId) ?? 0) < THUMB_VARIANTS.length)
  return { uploads, present, missingVariants }
}

/** YouTube 全局表情只存一份，key 用 `emojis/youtube/`。 */
function collectGlobalEmoji(): ThumbUpload[] {
  if (!existsSync(GLOBAL_EMOJI_DIR))
    return []
  return readdirSync(GLOBAL_EMOJI_DIR)
    .filter(name => name.endsWith('.png'))
    .map(name => ({
      key: emojiKey('youtube', name),
      body: readFileSync(join(GLOBAL_EMOJI_DIR, name)),
      contentType: 'image/png',
    }))
}

/** `data/<id>/emoji/<hash>.png` → 上传项；key 与页面拼 URL 的规则一致。 */
function collectEmoji(source: DatasetSource): ThumbUpload[] {
  const dir = join(resolve(APP_ROOT, source.datapackDir), 'emoji')
  if (!existsSync(dir))
    return []
  // 全局表情已经单独上传；旧目录里残留的副本不再重复上传。
  const globalFiles = new Set(existsSync(GLOBAL_EMOJI_DIR) ? readdirSync(GLOBAL_EMOJI_DIR) : [])
  const uploads: ThumbUpload[] = []
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.png') && globalFiles.has(name))
      continue
    if (name === 'index.json') {
      uploads.push({
        key: emojiKey(source.id, name),
        body: readFileSync(join(dir, name)),
        contentType: 'application/json',
      })
      continue
    }
    if (!name.endsWith('.png'))
      continue
    uploads.push({
      key: emojiKey(source.id, name),
      body: readFileSync(join(dir, name)),
      contentType: 'image/png',
    })
  }
  return uploads
}

/**
 * 生成 manifest / insights / authors 并增量上传资产。
 *
 * 返回 `{ exitCode, data }`；缺配置、本地镜像不完整这类「不该继续」的情况抛 `CliError`。
 */
export async function runPublishData(options: PublishDataOptions = {}): Promise<PublishDataResult> {
  const log = options.log ?? silentLog
  const dryRun = options.dryRun === true
  const force = options.force === true
  const assetsOnly = options.assetsOnly === true
  const noUpload = options.noUpload === true
  const adoptRemote = options.adoptRemote === true
  const allowShrink = options.allowShrink === true
  const datasetFilter = typeof options.dataset === 'string' && options.dataset.length > 0
    ? options.dataset
    : undefined
  const unchangedOptions = { adoptRemoteSize: adoptRemote }
  const onlyIds = options.ids
    ? new Set(readFileSync(options.ids, 'utf8').split(/\s+/).filter(Boolean))
    : undefined

  const config = readJson<{ datasets: DatasetSource[] }>(CONFIG_PATH)
  if (!Array.isArray(config.datasets) || config.datasets.length === 0)
    throw new CliError('data-sources.json 里没有 datasets', {
      hint: '在 data-sources.json 的 datasets 数组里补成员',
    })

  const selected = datasetFilter
    ? config.datasets.filter(source => source.id === datasetFilter)
    : config.datasets
  if (selected.length === 0) {
    throw new CliError(`data-sources.json 里没有 dataset：${datasetFilter}`, {
      hint: `可用：${config.datasets.map(source => source.id).join(', ')}`,
    })
  }

  const credentials = readCredentials()
  if (!noUpload && !credentials) {
    throw new CliError('缺少 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET', {
      hint: '在 .dev.vars 里配这四个变量；只生成本地文件请加 --no-upload',
    })
  }

  const store = credentials && !noUpload ? createObjectStore(credentials) : null
  const publishStartedAt = isoJst(new Date())
  const thumbUploads: ThumbUpload[] = []
  const emojiUploads: ThumbUpload[] = collectGlobalEmoji()
  const packUploads: { key: string, body: string }[] = []
  const indexUploads: { key: string, body: string }[] = []
  const indexSources = new Map<string, DatasetIndexSource>()

  for (const source of selected) {
    const packs = readPacks(source, Boolean(datasetFilter), log)
    if (!packs) continue
    const packsById = new Map(packs.map(pack => [pack.video.id, pack]))

    const streams = packs
      .map(pack => buildStreamSummary(pack, archiveKey(source.id, pack.video.id)))
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
      .map((stream, index) => ({ ...stream, rank: index + 1 }))

    const manifest: BatchManifest = {
      schema: MANIFEST_SCHEMA,
      generatedAt: publishStartedAt,
      subject: source.subject ?? source.label,
      channelId: source.channelId ?? null,
      scope: source.scope ?? '',
      count: streams.length,
      note: source.note ?? '',
      streams,
    }

    // 完整性校验：本地 pack 少于远端清单时拒绝覆盖，避免一次不完整的恢复把线上数据缩水。
    // --assets-only 不写 manifest，远端也没有可比的旧清单，跳过。
    if (store && !assetsOnly) {
      let remoteCount: number | null = null
      try {
        const remoteText = await store.get(manifestKey(source.id))
        if (remoteText) {
          const remote = JSON.parse(remoteText) as { count?: number, streams?: unknown[] }
          remoteCount = remote.count ?? (Array.isArray(remote.streams) ? remote.streams.length : null)
        }
      }
      catch (error) {
        log.warn(`  ! ${source.id} 读取远端 manifest 失败，跳过完整性校验：${error instanceof Error ? error.message : String(error)}`)
      }
      if (remoteCount != null && streams.length < remoteCount && !allowShrink) {
        throw new CliError(
          `${source.id} 本地只有 ${streams.length} 场，远端已有 ${remoteCount} 场；拒绝用不完整的本地镜像覆盖`,
          {
            hint: `先恢复 datapack（bun run ymmt data fetch --dataset ${source.id}），或确认要下架场次时加 --allow-shrink`,
          },
        )
      }
    }
    const totals = aggregateDataset(buildStreamRows(manifest, packsById))
    const insights = { schema: INSIGHTS_SCHEMA, generatedAt: publishStartedAt, totals }
    const authorIndex = buildAuthorIndex(source.id, packs, publishStartedAt)

    const dir = resolve(APP_ROOT, source.datapackDir)
    if (dryRun) {
      log.info(`${source.id} dry-run：跳过写 manifest / insights${authorIndex ? ' / authors' : ''}`)
    }
    else {
      writeJson(join(dir, 'manifest.json'), manifest)
      writeJson(join(dir, 'insights.json'), insights)
      if (authorIndex)
        writeJson(join(dir, 'authors.json'), authorIndex)
    }

    const thumbs = collectThumbs(source, onlyIds)
    thumbUploads.push(...thumbs.uploads)
    const emojiAssets = collectEmoji(source)
    emojiUploads.push(...emojiAssets)
    // manifest 说“有封面”但本地没文件时只警告：缺图的场次页面走兜底，不该挡住发布。
    const relevantStreams = onlyIds
      ? streams.filter(stream => onlyIds.has(stream.videoId))
      : streams
    const missingThumbs = relevantStreams.filter(stream => stream.thumbnail && !thumbs.present.has(stream.videoId))
    if (missingThumbs.length > 0) {
      const preview = missingThumbs.slice(0, 3).map(stream => stream.videoId).join(', ')
      const rest = missingThumbs.length > 3 ? ` 等 ${missingThumbs.length} 场` : ''
      log.warn(`  ! ${source.id} manifest 里有 ${missingThumbs.length} 场标了封面但本地没有图片（${preview}${rest}），先运行 bun run ymmt data thumbnails --dataset ${source.id}`)
    }
    // 缺变体时页面会退回原图（更慢但不会破图），同样只警告。
    if (thumbs.missingVariants.length > 0) {
      const preview = thumbs.missingVariants.slice(0, 3).join(', ')
      const rest = thumbs.missingVariants.length > 3 ? ` 等 ${thumbs.missingVariants.length} 张` : ''
      log.warn(`  ! ${source.id} 有 ${thumbs.missingVariants.length} 张封面缺 WebP 变体（${preview}${rest}），先运行 bun run ymmt data thumbnails --dataset ${source.id} 补齐`)
    }

    const variantCount = thumbs.uploads.filter(item => item.contentType === 'image/webp').length
    const agg = totals.aggregation
    const modeLabel = (mode: string | undefined, count: number): string => {
      if (mode === 'full')
        return '全量'
      if (mode === 'partial')
        return `部分 ${count}/${agg?.coverage.total ?? 0} 场`
      return 'Top 榜单相加'
    }
    const wordsMode = modeLabel(agg?.words, agg?.coverage.words ?? 0)
    const authorsMode = modeLabel(agg?.authors, agg?.coverage.authors ?? 0)
    log.info(`${source.label} (${source.id})：${streams.length} 场，本地已生成 manifest + insights（词频 ${wordsMode} / 发言者 ${authorsMode}），封面 ${thumbs.uploads.length - variantCount} 张 + 变体 ${variantCount} 个，表情 ${emojiAssets.length} 个`)
    if (!authorIndex)
      log.warn(`  ! ${source.id} 还有 v1 datapack，跳过作者索引；全量数据可精确聚合与观众重叠`)

    for (const pack of packs) {
      if (onlyIds && !onlyIds.has(pack.video.id))
        continue
      packUploads.push({ key: archiveKey(source.id, pack.video.id as string), body: JSON.stringify(pack) })
    }
    if (!assetsOnly) {
      indexUploads.push({ key: manifestKey(source.id), body: JSON.stringify(manifest) })
      indexUploads.push({ key: insightsKey(source.id), body: JSON.stringify(insights) })
      if (authorIndex)
        indexUploads.push({ key: authorsKey(source.id), body: JSON.stringify(authorIndex) })
    }

    indexSources.set(source.id, {
      id: source.id,
      label: source.label,
      color: source.color,
      avatar: source.avatar,
      channelId: source.channelId ?? manifest.channelId,
      count: streams.length,
      generatedAt: manifest.generatedAt,
    })
  }

  // 组级精简数据由全部成员的最新 manifest 派生；--dataset 只发布一部分时，
  // 其余成员优先读本地 manifest，本地没有再从对象存储读，避免组级文件少人。
  if (!assetsOnly) {
    const groupManifests: { id: string, streams: BatchManifest['streams'] }[] = []
    for (const source of config.datasets) {
      const manifestPath = join(resolve(APP_ROOT, source.datapackDir), 'manifest.json')
      let manifest: BatchManifest | null = null

      if (existsSync(manifestPath)) {
        manifest = readJson<BatchManifest>(manifestPath)
      }
      else if (store) {
        try {
          const text = await store.get(manifestKey(source.id))
          if (text)
            manifest = JSON.parse(text) as BatchManifest
        }
        catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          log.warn(`  ! ${source.id} 读取远端 manifest 失败：${detail}`)
        }
      }

      if (!manifest || !Array.isArray(manifest.streams) || manifest.streams.length === 0) {
        log.warn(`  ! ${source.id} 没有可用 manifest，组级数据里跳过`)
        continue
      }
      groupManifests.push({ id: source.id, streams: manifest.streams })
    }

    const groupSummary = buildGroupSummary(groupManifests, publishStartedAt)
    const groupGallery = buildGroupGallery(groupManifests, publishStartedAt)
    indexUploads.push({ key: groupSummaryKey(), body: JSON.stringify(groupSummary) })
    indexUploads.push({ key: groupGalleryKey(), body: JSON.stringify(groupGallery) })
    const groupStreamCount = groupSummary.members.reduce((sum, member) => sum + member.streamCount, 0)
    log.info(`组级数据：${groupStreamCount} 场 / ${groupSummary.days.length} 个日期桶（首页 ${Math.round(JSON.stringify(groupSummary).length / 1024)} KB，相册 ${Math.round(JSON.stringify(groupGallery).length / 1024)} KB）`)
  }

  const datasetIds = [...indexSources.keys()]

  if (!store || !credentials) {
    log.info('已跳过上传（--no-upload）')
    log.info('手动上传示例：rclone sync data/<id> r2:<bucket>/<id>')
    return {
      exitCode: 0,
      data: {
        dryRun,
        upload: false,
        datasets: datasetIds,
        thumbs: { collected: thumbUploads.length, uploaded: 0 },
        packs: { collected: packUploads.length, uploaded: 0 },
      },
    }
  }

  // --dataset 只重算了一部分：其余 dataset 沿用远端索引里的条目，远端没有再看本地 manifest。
  let datasetIndex: DatasetIndex | null = null
  if (!assetsOnly) {
    const missing = config.datasets.filter(source => !indexSources.has(source.id))
    if (missing.length > 0) {
      let published: DatasetIndex | null = null
      try {
        const text = await store.get(INDEX_KEY)
        if (text)
          published = JSON.parse(text) as DatasetIndex
      }
      catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        log.warn(`  ! 读取远端 ${INDEX_KEY} 失败（${detail}）`)
      }

      for (const source of missing) {
        const entry = published?.datasets?.find(item => item.id === source.id)
        if (entry) {
          indexSources.set(source.id, entry)
          continue
        }
        const manifestPath = join(resolve(APP_ROOT, source.datapackDir), 'manifest.json')
        if (!existsSync(manifestPath)) {
          log.warn(`  ! ${source.id} 没有可用的 manifest，dataset 索引里跳过`)
          continue
        }
        const manifest = readJson<BatchManifest>(manifestPath)
        indexSources.set(source.id, {
          id: source.id,
          label: source.label,
          color: source.color,
          avatar: source.avatar,
          channelId: source.channelId ?? manifest.channelId,
          count: manifest.count ?? manifest.streams?.length ?? 0,
          generatedAt: manifest.generatedAt ?? null,
        })
      }
    }

    datasetIndex = buildDatasetIndex(
      config.datasets.flatMap((source) => {
        const entry = indexSources.get(source.id)
        return entry ? [entry] : []
      }),
      publishStartedAt,
    )
  }

  // 进度记录：内容摘要对齐就不重传；同时列一次远端，确认对象还在、大小对得上。
  const statePath = publishStatePath(APP_ROOT)
  const state = readPublishState(statePath, publishTarget(credentials))
  /** dry-run 时不落盘，其它情况保持原来的写进度语义。 */
  const saveState = (): void => {
    if (!dryRun)
      writePublishState(statePath, state)
  }

  let remote: Map<string, number> | null = null
  if (!force) {
    try {
      remote = await store.list()
    }
    catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      log.warn(`  ! 列远端对象失败（${detail}），只按本地进度判断；要全量重传加 --force`)
    }
  }
  if (adoptRemote)
    log.info('--adopt-remote：本地没有进度记录时按远端大小对齐，只补差异')

  // 封面与表情先传：manifest / pack 指向这些 key，先有图再更新摘要才不会出现破图。
  const plannedThumbs = [...thumbUploads, ...emojiUploads].map((item) => {
    const digest = digestBytes(item.body)
    const unchanged = isUnchanged(state.objects[item.key], digest, remote, item.key, unchangedOptions)
    return { ...item, digest, skip: !force && unchanged }
  })
  const pendingThumbs = plannedThumbs.filter(item => !item.skip)
  const skippedThumbs = plannedThumbs.length - pendingThumbs.length
  const adoptedThumbs = plannedThumbs.filter(item => item.skip && !state.objects[item.key]).length

  let thumbsUploaded = 0
  if (dryRun) {
    log.info(`dry-run：不上传，计划 ${pendingThumbs.length} 个封面 / 变体 / 表情（跳过 ${skippedThumbs} 个未变化）`)
  }
  else {
    if (adoptedThumbs > 0) {
      // 按远端大小对齐后写入摘要，下一次才能检测同尺寸的内容变化。
      for (const item of plannedThumbs) {
        if (item.skip && !state.objects[item.key])
          state.objects[item.key] = { ...item.digest, uploadedAt: new Date().toISOString() }
      }
      saveState()
    }

    if (plannedThumbs.length === 0) {
      log.info('本地没有封面或表情，跳过（先运行 bun run ymmt data thumbnails / data emoji）')
    }
    else if (force) {
      log.info(`--force：忽略本地进度，全量上传 ${pendingThumbs.length} 个封面 / 变体 / 表情...`)
    }
    else if (skippedThumbs > 0) {
      const adopted = adoptedThumbs > 0 ? `，其中 ${adoptedThumbs} 个按远端大小对齐` : ''
      log.info(`上传 ${pendingThumbs.length} 个封面 / 变体 / 表情（跳过 ${skippedThumbs} 个未变化${adopted}）...`)
    }
    else {
      log.info(`上传 ${pendingThumbs.length} 个封面 / 变体 / 表情...`)
    }

    try {
      await runPool(pendingThumbs, 4, async (item) => {
        await store.putObject(item.key, item.body, item.contentType)
        state.objects[item.key] = { ...item.digest, uploadedAt: new Date().toISOString() }
        thumbsUploaded += 1
        if (thumbsUploaded % 20 === 0)
          saveState()
      })
    }
    finally {
      if (thumbsUploaded > 0)
        saveState()
    }
  }

  const planned = packUploads.map((item) => {
    const digest = digestBody(item.body)
    const unchanged = isUnchanged(state.objects[item.key], digest, remote, item.key, unchangedOptions)
    return { ...item, digest, skip: !force && unchanged }
  })
  const pending = planned.filter(item => !item.skip)
  const skipped = planned.length - pending.length
  const adoptedPacks = planned.filter(item => item.skip && !state.objects[item.key]).length

  let uploaded = 0
  if (dryRun) {
    log.info(`dry-run：不上传，计划 ${pending.length} 个 datapack（跳过 ${skipped} 个未变化）`)
  }
  else {
    if (adoptedPacks > 0) {
      for (const item of planned) {
        if (item.skip && !state.objects[item.key])
          state.objects[item.key] = { ...item.digest, uploadedAt: new Date().toISOString() }
      }
      saveState()
    }

    if (force)
      log.info(`--force：忽略本地进度，全量上传 ${pending.length} 个 datapack...`)
    else if (skipped > 0) {
      const adopted = adoptedPacks > 0 ? `，其中 ${adoptedPacks} 个按远端大小对齐` : ''
      log.info(`上传 ${pending.length} 个 datapack（跳过 ${skipped} 个未变化${adopted}）...`)
    }
    else
      log.info(`上传 ${pending.length} 个 datapack...`)

    try {
      await runPool(pending, 8, async (item) => {
        await store.put(item.key, item.body)
        state.objects[item.key] = { ...item.digest, uploadedAt: new Date().toISOString() }
        uploaded += 1
        // 中途被打断时最多丢掉这一批的进度，不至于下次全量重传。
        if (uploaded % 20 === 0)
          saveState()
      })
    }
    finally {
      if (uploaded > 0)
        saveState()
    }
  }

  // 索引最后写：即使中途失败，也是“多一个 pack”而不是“指向不存在的 pack”。
  let indexUploaded = 0
  let indexSkipped = 0
  if (indexUploads.length > 0) {
    const plannedIndex = indexUploads.map((item) => {
      const digest = digestBody(item.body)
      // 索引很小，且内容变化可能不改变字节数；不用大小对齐，按摘要判断。
      const unchanged = isUnchanged(state.objects[item.key], digest, remote, item.key)
      return { ...item, digest, skip: !force && unchanged }
    })
    const pendingIndex = plannedIndex.filter(item => !item.skip)
    indexSkipped = plannedIndex.length - pendingIndex.length
    const adoptedIndex = plannedIndex.filter(item => item.skip && !state.objects[item.key]).length
    const suffix = adoptedIndex > 0 ? `，其中 ${adoptedIndex} 个按远端大小对齐` : ''

    if (dryRun) {
      log.info(`dry-run：不上传，计划 ${pendingIndex.length} 个 manifest / insights / 组级数据（跳过 ${indexSkipped} 个未变化）`)
    }
    else {
      log.info(`上传 ${pendingIndex.length} 个 manifest / insights / 组级数据（跳过 ${indexSkipped} 个未变化${suffix}）...`)

      try {
        await runPool(pendingIndex, 2, async (item) => {
          await store.put(item.key, item.body)
          state.objects[item.key] = { ...item.digest, uploadedAt: new Date().toISOString() }
          indexUploaded += 1
        })
      }
      finally {
        if (indexUploaded > 0)
          saveState()
      }
    }
  }

  if (datasetIndex) {
    const body = JSON.stringify(datasetIndex)
    const digest = digestBody(body)
    const unchanged = !force
      && isUnchanged(state.objects[INDEX_KEY], digest, remote, INDEX_KEY)
    if (unchanged) {
      log.info(`dataset 索引未变化，跳过 ${INDEX_KEY}`)
    }
    else if (dryRun) {
      log.info(`dry-run：不上传 dataset 索引 ${INDEX_KEY}（${datasetIndex.datasets.length} 个 dataset）`)
    }
    else {
      log.info(`上传 dataset 索引 ${INDEX_KEY}（${datasetIndex.datasets.length} 个 dataset）...`)
      await store.put(INDEX_KEY, body)
      state.objects[INDEX_KEY] = { ...digest, uploadedAt: new Date().toISOString() }
      saveState()
    }
  }

  const base = remoteBase()
  log.info(`完成${base ? `：${base}` : ''}`)
  if (base)
    log.line(`校验可达性：bun run ymmt validate data --remote`)

  return {
    exitCode: 0,
    data: {
      dryRun,
      upload: true,
      target: publishTarget(credentials),
      datasets: [...indexSources.keys()],
      thumbs: { uploaded: thumbsUploaded, skipped: skippedThumbs, adopted: adoptedThumbs },
      packs: { uploaded, skipped, adopted: adoptedPacks },
      index: { uploaded: indexUploaded, skipped: indexSkipped },
      base: base || null,
    },
  }
}

export const publishDataSpec: CommandSpec = {
  id: 'publish.data',
  description: '发布数据：由本地 pack 派生 manifest / insights，并上传封面、表情与 archive',
  details: '本地 data/<id>/*.datapack.json 是唯一真源；本命令派生 manifest / insights（写回本地）'
    + ' 并把封面 / 表情 / archive 上传到对象存储。\n'
    + '增量：内容摘要记在 data/.publish-state.json，未变化且远端对得上的对象跳过。\n'
    + '上传需要 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET；只生成文件用 --no-upload。',
  examples: [
    'bun run ymmt publish data',
    'bun run ymmt publish data --dataset nonoka',
    'bun run ymmt publish data --no-upload',
    'bun run ymmt publish data --assets-only --force',
    'bun run ymmt publish data --dry-run --json',
  ],
  options: [
    new Option('--dataset <id>', '只发布指定 dataset'),
    new Option('--ids <文件>', '只上传文件里列出的 videoId（每行一个）；索引仍会刷新'),
    new Option('--assets-only', '只上传封面 / 表情 / archive，不写 JSON 索引'),
    new Option('--no-upload', '只生成本地文件，不上传'),
    new Option('--force', '忽略 data/.publish-state.json 的进度，全量重传'),
    new Option('--adopt-remote', '本地没有进度记录时，远端对象大小与本地一致就跳过（首次同步不重传）'),
    new Option('--allow-shrink', '允许本地场次少于远端（确实要下架场次时才用）'),
  ],
  async run(ctx) {
    const result = await runPublishData({
      dataset: typeof ctx.options.dataset === 'string' ? ctx.options.dataset : undefined,
      ids: typeof ctx.options.ids === 'string' ? ctx.options.ids : undefined,
      // commander 把 `--no-upload` 存成 `upload: false`（默认 true）。
      noUpload: ctx.options.upload === false,
      assetsOnly: ctx.flag('assetsOnly'),
      force: ctx.flag('force'),
      adoptRemote: ctx.flag('adoptRemote'),
      allowShrink: ctx.flag('allowShrink'),
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    const data = result.data as { dryRun?: boolean, upload?: boolean } | undefined
    return {
      exitCode: result.exitCode,
      data: result.data,
      summary: data?.dryRun
        ? 'dry-run：未写入本地文件、未上传'
        : data?.upload === false
          ? '已生成本地文件，未上传'
          : '发布数据完成',
    }
  },
}
