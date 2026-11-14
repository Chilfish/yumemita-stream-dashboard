/**
 * 导入已经写好的逐字稿。
 *
 *   bun run ymmt transcript import <path>
 *   bun run ymmt transcript import <path> --dataset nonoka
 *   bun run ymmt transcript import <path> --video-id W0bKqP-Eyj4
 *
 * <path> 可以是单篇、某个 `配信/`、成员目录、`団体配信/`，或它们的上一层（成员根目录）。
 * dataset 按以下顺序推断：
 *
 * 1. `--dataset` 显式指定；
 * 2. 文件路径上的成员目录名（`宮永ののか` → `nonoka`）；
 * 3. 都不命中时用 frontmatter / `--video-id` 的 videoId 查数据库 `streams.dataset_id`，
 *    取真正的投稿者（团体配信就是这种情况）；
 *
 * 其余流程不变：
 * - videoId 来源顺序：frontmatter → `--video-id` → 文件名日期在 manifest 里的唯一匹配；
 * - 去掉 `<!-- archive-only:start/end -->` 之间或整节「与既有档案的互证」；
 * - 复制到 `content/transcripts/<datasetId>/<videoId>.md`，其余正文不改写；
 * - 缺 videoId / date / title 时按 manifest 补进 frontmatter（只补缺的字段）；
 * - 会员限定场次默认拒绝导入，确需例外时加 `--allow-member-only`；
 * - 目标文件已存在时默认拒绝，加 `--force` 才覆盖。
 *
 * 目录模式会递归发现稿件：成员目录取 `配信/*.md`，`団体配信/` 取顶层 `*.md`，
 * 跳过 `raw/`、`_` / `.` / `00_` 开头的文件。不合规的稿件记为跳过并继续，
 * 只有读写失败才让退出码变 1；单篇模式仍然失败即退出。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Option } from 'commander'
import { inArray } from 'drizzle-orm'
import { createDb } from '@/db/connection.ts'
import { streams } from '@/db/schema.ts'
import {
  normalizeFrontmatter,
  parseFrontmatter,
  parseTranscriptFile,
  stripArchiveBlock,
} from '@/lib/transcripts.ts'
import type { BatchManifest } from '@/types/dataset.ts'
import type { CommandSpec } from '@scripts/lib/cli/runtime.ts'
import { CliError, UsageError } from '@scripts/lib/cli/exit.ts'
import { createLogger, type Logger } from '@scripts/lib/cli/logger.ts'
import {
  collectTranscriptSources,
  datasetFromPath,
  datasetLabelIndex,
} from '@scripts/lib/transcript-sources.ts'

interface DatasetSource {
  id: string
  label: string
  datapackDir?: string
  manifest?: string
}

// 文件在 scripts/commands/transcript/，仓库根在上三级。
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const CONTENT_ROOT = join(APP_ROOT, 'content', 'transcripts')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')

export interface TranscriptImportOptions {
  /** 位置参数 `<path>`：单个文件，或包含稿件 / 成员目录的目录。 */
  path?: string
  dataset?: string
  videoId?: string
  allowMemberOnly?: boolean
  force?: boolean
  dryRun?: boolean
  log?: Logger
}

export interface TranscriptImportOutcomeData {
  batch: boolean
  datasetIds: string[]
  written: {
    file: string
    target: string
    datasetId: string
    videoId: string
    origin: string
    datasetOrigin: string
    notes: string[]
  }[]
  skipped: string[]
  failed: string[]
}

export interface TranscriptImportResult {
  exitCode: number
  data: TranscriptImportOutcomeData
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 从文件名里抠日期：`2026-10-13_标题.md` 或 `20261013_标题.md`。 */
function dateFromName(name: string): string | null {
  const dashed = /(\d{4})-(\d{2})-(\d{2})/.exec(name)
  if (dashed)
    return `${dashed[1]}-${dashed[2]}-${dashed[3]}`
  const compact = /(?:^|\D)(\d{4})(\d{2})(\d{2})(?:\D|$)/.exec(name)
  if (compact)
    return `${compact[1]}-${compact[2]}-${compact[3]}`
  return null
}

function yamlScalar(value: string): string {
  if (value === '')
    return '""'
  const needsQuotes = /^\s|\s$|[:#[\]{},"'&*?|>@`]/.test(value)
  if (!needsQuotes)
    return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** 只补 frontmatter 里缺的字段，正文原样保留。 */
function ensureFrontmatter(
  source: string,
  fields: { videoId: string, date: string | null, title: string | null },
): { text: string, added: string[] } {
  const existing = normalizeFrontmatter(parseFrontmatter(source).data)
  const additions: string[] = []
  if (!existing.videoId)
    additions.push(`videoId: ${yamlScalar(fields.videoId)}`)
  if (!existing.date && fields.date)
    additions.push(`date: ${yamlScalar(fields.date)}`)
  if (!existing.title && fields.title)
    additions.push(`title: ${yamlScalar(fields.title)}`)
  if (additions.length === 0)
    return { text: source, added: [] }

  const normalized = source.replace(/^\uFEFF/, '')
  const block = ['---', ...additions, '---', '', normalized.trimStart()].join('\n')

  const lines = normalized.split('\n')
  if (!/^---[ \t]*$/.test(lines[0] ?? ''))
    return { text: block, added: additions }

  const closing = lines.findIndex((line, index) => index > 0 && /^---[ \t]*$/.test(line))
  if (closing < 0)
    return { text: block, added: additions }

  return {
    text: [lines[0], ...additions, ...lines.slice(1)].join('\n'),
    added: additions,
  }
}

type VideoIdOrigin = 'frontmatter' | 'flag' | 'manifest'

const ORIGIN_LABEL: Record<VideoIdOrigin, string> = {
  frontmatter: 'frontmatter',
  flag: '--video-id',
  manifest: '文件名日期匹配 manifest',
}

type DatasetOrigin = 'flag' | 'folder' | 'database'

const DATASET_ORIGIN_LABEL: Record<DatasetOrigin, string> = {
  flag: '--dataset',
  folder: '目录名',
  database: '数据库 owner',
}

type Outcome =
  | {
    kind: 'written'
    targetPath: string
    videoId: string
    datasetOrigin: DatasetOrigin
    origin: VideoIdOrigin
    notes: string[]
  }
  | { kind: 'skipped', reason: string }
  | { kind: 'failed', reason: string }

/** 一篇稿件在进入导入前已经确定的归属。 */
interface PreparedSource {
  filePath: string
  text: string
  videoId: string
  datasetId: string | null
  datasetOrigin: DatasetOrigin | null
  /** 无法确定 dataset 时的原因，批量模式记为跳过。 */
  unresolved?: string
}

/** 一次导入的上下文：批量标志 / 选项 / manifest 缓存。 */
interface ImportContext {
  batch: boolean
  videoIdFlag?: string
  allowMemberOnly: boolean
  force: boolean
  /** 全局 --dry-run：只校验，不写目标文件。 */
  dryRun: boolean
  readManifest: (datasetId: string) => BatchManifest | null
}

/** 处理一篇稿。不合规的只返回跳过原因，由调用方决定是否致命。 */
function importOne(
  source: PreparedSource,
  seen: Map<string, string>,
  context: ImportContext,
): Outcome {
  const { filePath, text } = source
  const datasetId = source.datasetId as string
  const datasetOrigin = source.datasetOrigin as DatasetOrigin
  const fileName = basename(filePath)
  const frontmatter = normalizeFrontmatter(parseFrontmatter(text).data)
  let videoId = frontmatter.videoId
  let resolvedDate = frontmatter.date
  let resolvedTitle = frontmatter.title
  let origin: VideoIdOrigin = 'frontmatter'

  if (!videoId && !context.batch && context.videoIdFlag) {
    videoId = context.videoIdFlag
    origin = 'flag'
  }

  if (!videoId) {
    const date = dateFromName(fileName)
    if (!date)
      return { kind: 'skipped', reason: 'frontmatter 没有 videoId，文件名里也没有日期' }

    const manifest = context.readManifest(datasetId)
    if (!manifest || !Array.isArray(manifest.streams))
      return { kind: 'skipped', reason: `frontmatter 没有 videoId，又读不到 ${datasetId} 的 manifest` }

    const candidates = manifest.streams.filter(
      stream => stream.date === date || (stream.startedAt ?? '').slice(0, 10) === date,
    )
    if (candidates.length === 0)
      return { kind: 'skipped', reason: `manifest 里没有 ${date} 的场次` }
    if (candidates.length > 1) {
      const ids = candidates.map(candidate => candidate.videoId).join(', ')
      return {
        kind: 'skipped',
        reason: `${date} 对上 ${candidates.length} 场（${ids}），请单独加 --video-id 导入`,
      }
    }
    const matched = candidates[0]
    videoId = matched.videoId
    resolvedDate = resolvedDate ?? matched.date ?? date
    resolvedTitle = resolvedTitle ?? matched.title ?? null
    origin = 'manifest'
  }

  const duplicate = seen.get(`${datasetId}/${videoId}`)
  if (duplicate)
    return { kind: 'skipped', reason: `videoId ${videoId} 与 ${duplicate} 重复` }

  const notes: string[] = []
  if (!/^[\w-]{6,}$/.test(videoId))
    notes.push(`videoId 看起来不像 YouTube id：${videoId}`)

  const stream = context.readManifest(datasetId)?.streams?.find(item => item.videoId === videoId) ?? null
  if (stream) {
    if (stream.availability === 'subscriber_only' && !context.allowMemberOnly) {
      return {
        kind: 'skipped',
        reason: `${videoId} 是会员限定场次：逐字稿只留在 archives，确需导入请加 --allow-member-only`,
      }
    }
    if (frontmatter.date && stream.date && frontmatter.date !== stream.date)
      notes.push(`frontmatter date ${frontmatter.date} 与 manifest ${stream.date} 不一致`)
    if (frontmatter.title && stream.title && frontmatter.title !== stream.title)
      notes.push('frontmatter title 与 manifest 不一致（title 取原片日文标题）')
    resolvedDate = resolvedDate ?? stream.date ?? null
    resolvedTitle = resolvedTitle ?? stream.title ?? null
  }
  else {
    notes.push(`manifest 里没有 ${videoId}，确认 id 没写错（发布时不会拦，索引页会多一条）`)
  }

  const targetDir = join(CONTENT_ROOT, datasetId)
  const targetPath = join(targetDir, `${videoId}.md`)
  if (existsSync(targetPath) && !context.force)
    return { kind: 'skipped', reason: `${relative(APP_ROOT, targetPath)} 已存在（加 --force 覆盖）` }

  const body = stripArchiveBlock(text)
  const supplemented = ensureFrontmatter(body, {
    videoId,
    date: resolvedDate,
    title: resolvedTitle,
  })

  let parsed: ReturnType<typeof parseTranscriptFile>
  try {
    parsed = parseTranscriptFile(supplemented.text, targetPath)
  }
  catch (error) {
    return { kind: 'failed', reason: errorMessage(error) }
  }

  try {
    if (!context.dryRun)
      mkdirSync(targetDir, { recursive: true })
    const output = supplemented.text.endsWith('\n') ? supplemented.text : `${supplemented.text}\n`
    if (!context.dryRun)
      writeFileSync(targetPath, output, 'utf8')
  }
  catch (error) {
    return { kind: 'failed', reason: `写入失败：${errorMessage(error)}` }
  }
  seen.set(`${datasetId}/${videoId}`, fileName)

  if (body !== text)
    notes.push('已去掉仅供归档的段落')
  for (const line of supplemented.added)
    notes.push(`补了 frontmatter：${line}`)
  if (parsed.frontmatter.title)
    notes.push(`标题：${parsed.frontmatter.title}`)
  notes.push(`目录 ${parsed.toc.length} 节，正文 ${parsed.markdown.split('\n').length} 行`)

  return { kind: 'written', targetPath, videoId, datasetOrigin, origin, notes }
}

/** 用 videoId 查真正的投稿者；数据库不可用时返回错误，由调用方记为跳过。 */
async function lookupOwners(videoIds: string[]): Promise<{ owners: Map<string, string>, error: string | null }> {
  if (videoIds.length === 0) return { owners: new Map(), error: null }
  const url = process.env.DATABASE_URL
  if (!url) return { owners: new Map(), error: 'DATABASE_URL 未配置' }

  try {
    const db = createDb(url)
    const rows = await db
      .select({ videoId: streams.videoId, datasetId: streams.datasetId })
      .from(streams)
      .where(inArray(streams.videoId, videoIds))
    const owners = new Map<string, string>()
    for (const row of rows) {
      if (!owners.has(row.videoId))
        owners.set(row.videoId, row.datasetId)
    }
    return { owners, error: null }
  }
  catch (error) {
    return { owners: new Map(), error: errorMessage(error) }
  }
}

/**
 * 业务主体：发现源稿件、推断归属，然后逐篇导入。
 *
 * 批量模式下不合规的稿件记为跳过并继续，只有读写失败才让退出码变 1；
 * 单篇模式仍然失败即退出，避免静默什么都不做。`dryRun` 时不写目标文件。
 */
export async function runTranscriptImport(
  options: TranscriptImportOptions,
): Promise<TranscriptImportResult> {
  const log = options.log ?? createLogger({ name: 'transcript.import' })
  const sourcePath = options.path?.trim()
  if (!sourcePath) {
    throw new UsageError('缺少源文件路径', {
      hint: 'bun run ymmt transcript import <path>',
      context: { argument: 'path' },
    })
  }

  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { datasets?: DatasetSource[] }
  const datasets = config.datasets ?? []
  const datasetById = new Map(datasets.map(dataset => [dataset.id, dataset]))
  const labelIndex = datasetLabelIndex(datasets)

  let datasetFlag: DatasetSource | null = null
  const datasetIdFlag = options.dataset?.trim()
  if (datasetIdFlag) {
    datasetFlag = datasetById.get(datasetIdFlag) ?? null
    if (!datasetFlag) {
      const available = datasets.map(dataset => dataset.id).join(', ')
      throw new CliError(`data-sources.json 里没有 dataset：${datasetIdFlag}`, {
        code: 'UNKNOWN_DATASET',
        hint: `可用：${available || '(data-sources.json 为空)'}`,
        context: { dataset: datasetIdFlag },
      })
    }
  }

  const absoluteSource = resolve(sourcePath)
  if (!existsSync(absoluteSource)) {
    throw new CliError(`源文件不存在：${absoluteSource}`, {
      code: 'MISSING_SOURCE',
      hint: '检查 <path>；目录会自动发现成员目录下的 配信/*.md 与团体配信的 *.md',
      context: { path: absoluteSource },
    })
  }

  const batch = statSync(absoluteSource).isDirectory()
  if (batch && options.videoId) {
    throw new UsageError('--video-id 只对单篇生效；批量导入时 videoId 必须写在各篇 frontmatter 里', {
      context: { option: 'videoId' },
    })
  }

  const manifests = new Map<string, BatchManifest | null>()
  const readManifest = (datasetId: string): BatchManifest | null => {
    if (manifests.has(datasetId))
      return manifests.get(datasetId) ?? null
    const dataset = datasetById.get(datasetId)
    const rel = dataset?.manifest ?? join(dataset?.datapackDir ?? `data/${datasetId}`, 'manifest.json')
    const path = resolve(APP_ROOT, rel)
    if (!existsSync(path)) {
      manifests.set(datasetId, null)
      return null
    }
    try {
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as BatchManifest
      manifests.set(datasetId, manifest)
      return manifest
    }
    catch (error) {
      log.warn(`读取 ${relative(APP_ROOT, path)} 失败：${errorMessage(error)}`)
      manifests.set(datasetId, null)
      return null
    }
  }

  const data: TranscriptImportOutcomeData = {
    batch,
    datasetIds: [],
    written: [],
    skipped: [],
    failed: [],
  }

  const sources = collectTranscriptSources(absoluteSource)
  if (sources.length === 0) {
    log.info(`${absoluteSource} 里没有可导入的 .md`)
    return { exitCode: 0, data }
  }

  // 先读一遍并确定归属；后续 importOne 复用同一份文本，避免重复读盘。
  const prepared: PreparedSource[] = []
  for (const filePath of sources) {
    const label = basename(filePath)
    let text: string
    try {
      text = readFileSync(filePath, 'utf8')
    }
    catch (error) {
      data.failed.push(`${label}：读取失败：${errorMessage(error)}`)
      log.error(`${label}：读取失败：${errorMessage(error)}`)
      continue
    }

    const frontmatter = normalizeFrontmatter(parseFrontmatter(text).data)
    const videoId = frontmatter.videoId || (!batch ? (options.videoId ?? '') : '')
    const fromFolder = datasetFlag ? null : datasetFromPath(filePath, labelIndex)
    prepared.push({
      filePath,
      text,
      videoId,
      datasetId: datasetFlag?.id ?? fromFolder,
      datasetOrigin: datasetFlag ? 'flag' : fromFolder ? 'folder' : null,
    })
  }

  // 不在成员目录下的稿件（团体配信）用 videoId 查数据库，取真正的投稿者。
  const unresolved = prepared.filter(source => !source.datasetId && source.videoId)
  if (unresolved.length > 0) {
    const { owners, error } = await lookupOwners([...new Set(unresolved.map(source => source.videoId))])
    if (error)
      log.warn(`无法查询数据库归属（${error}）；团体配信会跳过`)
    for (const source of unresolved) {
      const owner = owners.get(source.videoId)
      if (owner && datasetById.has(owner)) {
        source.datasetId = owner
        source.datasetOrigin = 'database'
      }
      else if (owner) {
        source.unresolved = `数据库归属 ${owner} 不在 data-sources.json 里`
      }
      else {
        source.unresolved = error
          ? `无法从数据库推断 dataset（${error}）`
          : `数据库里没有 ${source.videoId}；可能是官方频道场次（暂不支持）或还没 ingest`
      }
    }
  }
  for (const source of prepared) {
    if (!source.datasetId && !source.unresolved)
      source.unresolved = '不在成员目录下，frontmatter 也没有可用的 videoId，无法推断 dataset'
  }

  if (batch) {
    const scopes = [...new Set(prepared.map(source => source.datasetId).filter(Boolean))] as string[]
    log.info(
      `批量导入 ${sources.length} 个文件`
      + `${scopes.length > 0 ? ` → ${scopes.join(', ')}` : ''}`,
    )
  }

  const context: ImportContext = {
    batch,
    videoIdFlag: options.videoId,
    allowMemberOnly: options.allowMemberOnly === true,
    force: options.force === true,
    dryRun: options.dryRun === true,
    readManifest,
  }

  const seen = new Map<string, string>()
  const datasetIds = new Set<string>()
  let written = 0

  for (const source of prepared) {
    const label = basename(source.filePath)
    if (!source.datasetId) {
      const reason = source.unresolved ?? '无法推断 dataset'
      if (!batch) {
        throw new CliError(`${label}：${reason}`, {
          code: 'SKIPPED_SOURCE',
          hint: '单篇导入失败即退出；也可以加 --dataset 显式指定成员',
          context: { file: label },
        })
      }
      data.skipped.push(`${label}：${reason}`)
      log.warn(`${label}：${reason}`)
      continue
    }

    const outcome = importOne(source, seen, context)

    if (outcome.kind === 'written') {
      written += 1
      datasetIds.add(source.datasetId)
      const target = relative(APP_ROOT, outcome.targetPath)
      log.info(
        `${context.dryRun ? '将写入（dry-run）' : '已写入'} ${target}（videoId ${outcome.videoId}，`
        + `${ORIGIN_LABEL[outcome.origin]}；dataset ${source.datasetId}，`
        + `${DATASET_ORIGIN_LABEL[outcome.datasetOrigin]}）`,
      )
      for (const note of outcome.notes) log.info(`  ${note}`)
      data.written.push({
        file: label,
        target,
        datasetId: source.datasetId,
        videoId: outcome.videoId,
        origin: ORIGIN_LABEL[outcome.origin],
        datasetOrigin: DATASET_ORIGIN_LABEL[outcome.datasetOrigin],
        notes: outcome.notes,
      })
      continue
    }

    if (outcome.kind === 'skipped') {
      if (!batch) {
        throw new CliError(`${label}：${outcome.reason}`, {
          code: 'SKIPPED_SOURCE',
          hint: '单篇导入失败即退出；批量导入（传目录）会跳过不合规的稿件继续',
          context: { file: label },
        })
      }
      data.skipped.push(`${label}：${outcome.reason}`)
      log.warn(`${label}：${outcome.reason}`)
      continue
    }

    data.failed.push(`${label}：${outcome.reason}`)
    log.error(`${label}：${outcome.reason}`)
  }

  data.datasetIds = [...datasetIds].sort()

  if (batch) {
    log.info(
      `批量导入完成：写入 ${written} 篇`
      + `${data.datasetIds.length > 1 ? `（${data.datasetIds.join(', ')}）` : ''}，`
      + `跳过 ${data.skipped.length} 篇`
      + `${data.failed.length > 0 ? `，失败 ${data.failed.length} 篇` : ''}`,
    )
  }
  if (written > 0)
    log.info('下一步：检查正文，然后运行 bun run ymmt publish transcripts')

  return { exitCode: data.failed.length > 0 ? 1 : 0, data }
}

export const transcriptImportSpec: CommandSpec = {
  id: 'transcript.import',
  description: '导入写好的 Markdown 逐字稿到 content/transcripts',
  details: [
    'dataset 推断顺序：`--dataset` → 路径里的成员目录名 → 用 videoId 查数据库取投稿者。',
    '所以可以只传一个归档根目录：成员目录取 `配信/*.md`，`団体配信/` 取顶层 `*.md`。',
    'videoId 来源顺序：frontmatter → `--video-id` → 文件名日期在 manifest 里的唯一匹配。',
    '会去掉只供归档的段落（`<!-- archive-only:start/end -->` 之间，或整节「与既有档案的互证」），',
    '并按 manifest 补上缺的 videoId / date / title（只补缺的字段）。',
    '',
    '批量模式下不合规的稿件记为跳过并继续，只有读写失败才让退出码变 1。',
    '单篇模式仍然失败即退出，避免静默什么都不做。',
  ].join('\n'),
  examples: [
    'bun run ymmt transcript import "D:/messages/archives/夢限大みゅーたいぷ/members"',
    'bun run ymmt transcript import "D:/messages/archives/…/members/宮永ののか/配信"',
    'bun run ymmt transcript import "D:/messages/archives/…/members/団体配信"',
    'bun run ymmt transcript import content/transcripts/draft.md --dataset nonoka --video-id W0bKqP-Eyj4',
  ],
  options: [
    new Option('--dataset <id>', '强制导入到该成员；省略时按目录名或数据库推断'),
    new Option('--video-id <id>', 'frontmatter 没有 videoId 时用它兜底（只对单篇生效）'),
    new Option('--allow-member-only', '会员限定场次默认拒绝导入，加此项才放行'),
    new Option('--force', '目标文件已存在时覆盖'),
  ],
  arguments: [{ name: 'path', description: '源 Markdown 文件，或包含稿件 / 成员目录的目录' }],
  async run(ctx) {
    const result = await runTranscriptImport({
      path: ctx.args[0],
      dataset: typeof ctx.options.dataset === 'string' ? ctx.options.dataset : undefined,
      videoId: typeof ctx.options.videoId === 'string' ? ctx.options.videoId : undefined,
      allowMemberOnly: ctx.flag('allowMemberOnly'),
      force: ctx.flag('force'),
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    return { exitCode: result.exitCode, data: result.data }
  },
}
