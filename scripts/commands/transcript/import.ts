/**
 * 导入已经写好的逐字稿。
 *
 *   bun run ymmt transcript import <path> --dataset nonoka
 *   bun run ymmt transcript import <path> --dataset nonoka --video-id W0bKqP-Eyj4
 *   bun run ymmt transcript import <dir>  --dataset nonoka
 *   bun run ymmt transcript import <dir>  --dataset nonoka --force
 *
 * 1. videoId 来源顺序：frontmatter → `--video-id` → 文件名日期在 manifest 里的唯一匹配；
 * 2. 去掉只供归档的段落（`<!-- archive-only:start/end -->` 之间，或整节「与既有档案的互证」）；
 * 3. 复制到 `content/transcripts/<datasetId>/<videoId>.md`，其余正文不改写；
 * 4. 缺 videoId / date / title 时按 manifest 补进 frontmatter（只补缺的字段）；
 * 5. 会员限定场次默认拒绝导入（逐字稿只留在归档侧），确需例外时加 `--allow-member-only`；
 * 6. 目标文件已存在时默认拒绝，加 `--force` 才覆盖。
 *
 * 路径是目录时批量导入其中的 `*.md`（不递归，`_` / `.` 开头的不算）。
 * 批量模式下不合规的稿件（缺 videoId、对不上 manifest、会员限定、目标已存在）记为跳过并继续，
 * 只有读写失败才让退出码变 1；单篇模式仍然失败即退出，避免静默什么都不做。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Option } from 'commander'
import {
  normalizeFrontmatter,
  parseFrontmatter,
  parseTranscriptFile,
  stripArchiveBlock,
} from '@/lib/transcripts.ts'
import type { CommandSpec } from '@scripts/lib/cli/runtime.ts'
import { CliError, UsageError } from '@scripts/lib/cli/exit.ts'
import { createLogger, type Logger } from '@scripts/lib/cli/logger.ts'
import type { BatchManifest } from '@/types/dataset.ts'

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
  /** 位置参数 `<path>`：单个文件或目录。 */
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
  datasetId: string
  written: { file: string, target: string, videoId: string, origin: string, notes: string[] }[]
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

/** 以 `_` / `.` 开头的文件是草稿或模板，不参与导入。 */
function isSkipped(name: string): boolean {
  return name.startsWith('_') || name.startsWith('.')
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

type Outcome =
  | {
    kind: 'written'
    targetPath: string
    videoId: string
    origin: VideoIdOrigin
    notes: string[]
  }
  | { kind: 'skipped', reason: string }
  | { kind: 'failed', reason: string }

/** 一次导入的上下文：dataset / 批量标志 / 选项 / manifest 缓存。 */
interface ImportContext {
  datasetId: string
  batch: boolean
  videoIdFlag?: string
  allowMemberOnly: boolean
  force: boolean
  /** 全局 --dry-run：只校验，不写目标文件。 */
  dryRun: boolean
  readManifest: () => BatchManifest | null
}

/** 处理一篇稿。不合规的只返回跳过原因，由调用方决定是否致命。 */
function importOne(filePath: string, seen: Map<string, string>, context: ImportContext): Outcome {
  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  }
  catch (error) {
    return { kind: 'failed', reason: `读取失败：${errorMessage(error)}` }
  }

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

    const manifest = context.readManifest()
    if (!manifest || !Array.isArray(manifest.streams))
      return { kind: 'skipped', reason: `frontmatter 没有 videoId，又读不到 ${context.datasetId} 的 manifest` }

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

  const duplicate = seen.get(videoId)
  if (duplicate)
    return { kind: 'skipped', reason: `videoId ${videoId} 与 ${duplicate} 重复` }

  const notes: string[] = []
  if (!/^[\w-]{6,}$/.test(videoId))
    notes.push(`videoId 看起来不像 YouTube id：${videoId}`)

  const stream = context.readManifest()?.streams?.find(item => item.videoId === videoId) ?? null
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

  const targetDir = join(CONTENT_ROOT, context.datasetId)
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
  seen.set(videoId, fileName)

  if (body !== text)
    notes.push('已去掉仅供归档的段落')
  for (const line of supplemented.added)
    notes.push(`补了 frontmatter：${line}`)
  if (parsed.frontmatter.title)
    notes.push(`标题：${parsed.frontmatter.title}`)
  notes.push(`目录 ${parsed.toc.length} 节，正文 ${parsed.markdown.split('\n').length} 行`)

  return { kind: 'written', targetPath, videoId, origin, notes }
}

/**
 * 业务主体：解析源路径（文件或目录）后逐篇导入。
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
      hint: 'bun run ymmt transcript import <path> --dataset nonoka',
      context: { argument: 'path' },
    })
  }
  const datasetIdFlag = options.dataset?.trim()
  if (!datasetIdFlag) {
    throw new UsageError('缺少 --dataset', {
      hint: 'bun run ymmt transcript import <path> --dataset nonoka',
      context: { option: 'dataset' },
    })
  }

  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { datasets?: DatasetSource[] }
  const dataset = (config.datasets ?? []).find(item => item.id === datasetIdFlag)
  if (!dataset) {
    const available = (config.datasets ?? []).map(item => item.id).join(', ')
    throw new CliError(`data-sources.json 里没有 dataset：${datasetIdFlag}`, {
      code: 'UNKNOWN_DATASET',
      hint: `可用：${available || '(data-sources.json 为空)'}`,
      context: { dataset: datasetIdFlag },
    })
  }

  const absoluteSource = resolve(sourcePath)
  if (!existsSync(absoluteSource)) {
    throw new CliError(`源文件不存在：${absoluteSource}`, {
      code: 'MISSING_SOURCE',
      hint: '检查 <path>；目录会批量导入其中的 *.md（不递归）',
      context: { path: absoluteSource },
    })
  }

  const batch = statSync(absoluteSource).isDirectory()
  if (batch && options.videoId) {
    throw new UsageError('--video-id 只对单篇生效；批量导入时 videoId 必须写在各篇 frontmatter 里', {
      context: { option: 'videoId' },
    })
  }

  const sources = batch
    ? readdirSync(absoluteSource, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.md') && !isSkipped(entry.name))
      .map(entry => join(absoluteSource, entry.name))
      .sort((a, b) => a.localeCompare(b))
    : [absoluteSource]

  const empty: TranscriptImportOutcomeData = { batch, datasetId: dataset.id, written: [], skipped: [], failed: [] }
  if (sources.length === 0) {
    log.info(`${absoluteSource} 里没有可导入的 .md`)
    return { exitCode: 0, data: empty }
  }
  if (batch)
    log.info(`批量导入 ${sources.length} 个文件 → ${dataset.id}`)

  let manifestCache: BatchManifest | null | undefined
  const readManifest = (): BatchManifest | null => {
    if (manifestCache !== undefined)
      return manifestCache
    const rel = dataset.manifest ?? join(dataset.datapackDir ?? `data/${dataset.id}`, 'manifest.json')
    const path = resolve(APP_ROOT, rel)
    if (!existsSync(path)) {
      manifestCache = null
      return null
    }
    try {
      manifestCache = JSON.parse(readFileSync(path, 'utf8')) as BatchManifest
    }
    catch (error) {
      log.warn(`读取 ${relative(APP_ROOT, path)} 失败：${errorMessage(error)}`)
      manifestCache = null
    }
    return manifestCache
  }

  const context: ImportContext = {
    datasetId: dataset.id,
    batch,
    videoIdFlag: options.videoId,
    allowMemberOnly: options.allowMemberOnly === true,
    force: options.force === true,
    dryRun: options.dryRun === true,
    readManifest,
  }

  const seen = new Map<string, string>()
  const data: TranscriptImportOutcomeData = { ...empty }
  let written = 0

  for (const filePath of sources) {
    const label = basename(filePath)
    const outcome = importOne(filePath, seen, context)

    if (outcome.kind === 'written') {
      written += 1
      const target = relative(APP_ROOT, outcome.targetPath)
      log.info(
        `${context.dryRun ? '将写入（dry-run）' : '已写入'} ${target}`
        + `（videoId ${outcome.videoId}，来源：${ORIGIN_LABEL[outcome.origin]}）`,
      )
      for (const note of outcome.notes) log.info(`  ${note}`)
      data.written.push({
        file: label,
        target,
        videoId: outcome.videoId,
        origin: ORIGIN_LABEL[outcome.origin],
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

  if (batch) {
    log.info(
      `批量导入完成：写入 ${written} 篇，跳过 ${data.skipped.length} 篇`
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
    'videoId 来源顺序：frontmatter → `--video-id` → 文件名日期在 manifest 里的唯一匹配。',
    '会去掉只供归档的段落（`<!-- archive-only:start/end -->` 之间，或整节「与既有档案的互证」），',
    '并按 manifest 补上缺的 videoId / date / title（只补缺的字段）。',
    '',
    '路径是目录时批量导入其中的 `*.md`（不递归，`_` / `.` 开头的不算）；',
    '批量模式下不合规的稿件记为跳过并继续，只有读写失败才让退出码变 1。',
    '单篇模式仍然失败即退出，避免静默什么都不做。',
  ].join('\n'),
  examples: [
    'bun run ymmt transcript import content/transcripts/draft.md --dataset nonoka',
    'bun run ymmt transcript import content/transcripts/draft.md --dataset nonoka --video-id W0bKqP-Eyj4',
    'bun run ymmt transcript import temp/drafts --dataset nonoka',
    'bun run ymmt transcript import temp/drafts --dataset nonoka --force',
  ],
  options: [
    new Option('--dataset <id>', '目标成员（必须是 data-sources.json 里的 id）'),
    new Option('--video-id <id>', 'frontmatter 没有 videoId 时用它兜底（只对单篇生效）'),
    new Option('--allow-member-only', '会员限定场次默认拒绝导入，加此项才放行'),
    new Option('--force', '目标文件已存在时覆盖'),
  ],
  arguments: [{ name: 'path', description: '源 Markdown 文件，或包含 *.md 的目录' }],
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
