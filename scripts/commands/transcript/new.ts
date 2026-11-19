/**
 * 从模板建一篇逐字稿。
 *
 *   bun run ymmt transcript new W0bKqP-Eyj4 --dataset nonoka
 *   bun run ymmt transcript new W0bKqP-Eyj4 --dataset nonoka --force
 *
 * 日期与标题从 `data/<dataset>/manifest.json` 带出，省掉手写 frontmatter 的成本。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Option } from 'commander'
import { type CommandSpec, CliError, UsageError, createLogger, type Logger } from '@chilfish/devkit/cli'
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
const TEMPLATE_PATH = join(CONTENT_ROOT, '.template.md')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')

export interface TranscriptNewOptions {
  /** 位置参数 `<videoId>`。 */
  videoId?: string
  dataset?: string
  force?: boolean
  dryRun?: boolean
  /** 人读进度输出；spec 传入 `ctx.log`。 */
  log?: Logger
}

export interface TranscriptNewResult {
  exitCode: number
  data?: {
    datasetId: string
    videoId: string
    target: string
    written: boolean
    date: string
    title: string
  }
}

/** YAML 里带特殊字符就加双引号，避免被行内数组或注释规则误伤。 */
function yamlScalar(value: string): string {
  if (value === '')
    return '""'
  const needsQuotes = /^\s|\s$|[:#[\]{},"'&*?|>@`]/.test(value)
  if (!needsQuotes)
    return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function readDataset(datasetId: string, log: Logger): DatasetSource {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { datasets?: DatasetSource[] }
  const dataset = (config.datasets ?? []).find(item => item.id === datasetId)
  if (!dataset) {
    const available = (config.datasets ?? []).map(item => item.id).join(', ')
    throw new CliError(`data-sources.json 里没有 dataset：${datasetId}`, {
      code: 'UNKNOWN_DATASET',
      hint: `可用：${available || '(data-sources.json 为空)'}`,
      context: { dataset: datasetId },
    })
  }
  log.debug(`dataset ${dataset.id}（${dataset.label}）`)
  return dataset
}

/**
 * 业务主体：读模板 → 用 manifest 的 date / title 填充 → 写到 `content/transcripts/<datasetId>/<videoId>.md`。
 *
 * 已存在的目标文件默认拒绝覆盖；`force` 为真才重写。`dryRun` 时只校验并报告目标路径，不落盘。
 */
export async function runTranscriptNew(options: TranscriptNewOptions): Promise<TranscriptNewResult> {
  const log = options.log ?? createLogger({ name: 'transcript.new' })
  const videoId = options.videoId?.trim()
  if (!videoId) {
    throw new UsageError('缺少 videoId', {
      hint: 'bun run ymmt transcript new <videoId> --dataset nonoka',
      context: { argument: 'videoId' },
    })
  }
  const datasetId = options.dataset?.trim()
  if (!datasetId) {
    throw new UsageError('缺少 --dataset', {
      hint: 'bun run ymmt transcript new W0bKqP-Eyj4 --dataset nonoka',
      context: { option: 'dataset' },
    })
  }

  const dataset = readDataset(datasetId, log)

  if (!existsSync(TEMPLATE_PATH)) {
    throw new CliError(`找不到模板 ${relative(APP_ROOT, TEMPLATE_PATH)}；它应该随仓库提交`, {
      code: 'MISSING_TEMPLATE',
      hint: `确认 content/transcripts/.template.md 在仓库里（git checkout -- ${relative(APP_ROOT, TEMPLATE_PATH)}）`,
    })
  }

  const manifestPath = resolve(
    APP_ROOT,
    dataset.manifest ?? join(dataset.datapackDir ?? `data/${dataset.id}`, 'manifest.json'),
  )
  let stream: BatchManifest['streams'][number] | null = null
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BatchManifest
      stream = (manifest.streams ?? []).find(item => item.videoId === videoId) ?? null
    }
    catch (error) {
      log.warn(`读取 ${relative(APP_ROOT, manifestPath)} 失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (!stream) {
    log.warn(`manifest 里没有 ${videoId}，date / title 留空，记得手填`)
  }

  const date = stream?.date ?? (stream?.startedAt ?? '').slice(0, 10)
  const title = stream?.title ?? ''
  const tokens: Record<string, string> = {
    videoId,
    datasetId: dataset.id,
    member: dataset.id,
    members: dataset.id,
    date,
    title: title ? yamlScalar(title) : '""',
    summary: '""',
    today: new Date().toISOString().slice(0, 10),
  }

  const template = readFileSync(TEMPLATE_PATH, 'utf8')
  const filled = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const replacement = tokens[key]
    return replacement === undefined ? match : replacement
  })

  const targetDir = join(CONTENT_ROOT, dataset.id)
  const targetPath = join(targetDir, `${videoId}.md`)
  if (existsSync(targetPath) && !options.force) {
    throw new CliError(`${relative(APP_ROOT, targetPath)} 已存在`, {
      code: 'TARGET_EXISTS',
      hint: `确认要覆盖请加 --force：bun run ymmt transcript new ${videoId} --dataset ${dataset.id} --force`,
      context: { target: relative(APP_ROOT, targetPath) },
    })
  }

  const written = !options.dryRun
  if (written) {
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(targetPath, filled.endsWith('\n') ? filled : `${filled}\n`, 'utf8')
  }

  log.info(written
    ? `已创建 ${relative(APP_ROOT, targetPath)}`
    : `dry-run：将创建 ${relative(APP_ROOT, targetPath)}（未写入）`)
  if (stream)
    log.info(`  ${date} · ${title}`)
  else
    log.warn('title 与 date 需要手填；videoId 已写入 frontmatter')
  if (written)
    log.info('写完运行：bun run ymmt publish transcripts')

  return {
    exitCode: 0,
    data: {
      datasetId: dataset.id,
      videoId,
      target: relative(APP_ROOT, targetPath),
      written,
      date,
      title,
    },
  }
}

export const transcriptNewSpec: CommandSpec = {
  id: 'transcript.new',
  description: '按 content/transcripts/.template.md 新建一篇逐字稿',
  details: '日期与标题从 `data/<dataset>/manifest.json` 带出，省掉手写 frontmatter 的成本。\n'
    + '目标文件已存在时默认拒绝，加 `--force` 才覆盖。全局 `--dry-run` 只校验并报告目标路径，不落盘。',
  examples: [
    'bun run ymmt transcript new W0bKqP-Eyj4 --dataset nonoka',
    'bun run ymmt transcript new W0bKqP-Eyj4 --dataset nonoka --force',
  ],
  options: [
    new Option('--dataset <id>', '目标成员（必须是 data-sources.json 里的 id）'),
    new Option('--force', '目标文件已存在时覆盖'),
  ],
  arguments: [{ name: 'videoId', description: 'YouTube videoId，会写进 frontmatter' }],
  async run(ctx) {
    const result = await runTranscriptNew({
      videoId: ctx.args[0],
      dataset: typeof ctx.options.dataset === 'string' ? ctx.options.dataset : undefined,
      force: ctx.flag('force'),
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    return { exitCode: result.exitCode, data: result.data }
  },
}
