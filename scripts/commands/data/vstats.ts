/**
 * 只补 VSTATS 单场页，不重抓 meta / 弹幕 / 评论，也不下载媒体。
 *
 *   bun run ymmt data vstats --dry-run
 *   bun run ymmt data vstats --dataset yuno
 *   bun run ymmt data vstats --dataset yuno --ids ids.txt --limit 5
 *
 * 候选取自本地 pack 的 manifest 摘要：`vstatsViews` 为空且 `availability = public` 的场次。
 * VSTATS 对未收录的视频返回 5 字节的 `error`，这类场次只记「未收录」，不算失败；
 * 5xx / 超时按临时失败处理，下轮重试。每轮默认随机取 20 场，避免旧场次永远排在队尾。
 *
 * 改完 pack 后同步 upsert manifest；入库与上传由 daily-update 或手动
 * `db ingest --ids` / `publish data --assets-only --ids` 完成。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { Option } from 'commander'
import { type Logger, type CommandSpec, CliError, UsageError } from '@chilfish/devkit/cli'
import { upsertManifestStream } from '@scripts/lib/dataset-manifest.ts'
import { deriveVstats, parseVstats, VSTATS_MIN_HTML_BYTES } from '@scripts/lib/vstats.ts'
import type { StreamDatapack } from '@/types/datapack.ts'

const APP_ROOT = resolve(import.meta.dir, '../../..')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')
const DEFAULT_LIMIT = 20
const DEFAULT_CONCURRENCY = 3

interface DatasetSource {
  id: string
  label: string
  manifest: string
  datapackDir: string
}

interface ManifestSummary {
  videoId?: string
  availability?: string | null
  vstatsViews?: number | null
}

interface Candidate {
  source: DatasetSource
  videoId: string
}

type Probe =
  | { kind: 'ok', vstats: ReturnType<typeof parseVstats> }
  | { kind: 'missing', detail: string }
  | { kind: 'transient', detail: string }

/** 注入的日志器；默认静默，方便测试与进程内调用。 */
export type CommandLog = Pick<Logger, 'info' | 'warn' | 'error'>

const SILENT_LOG: CommandLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

export interface RunVstatsOptions {
  /** 只处理指定 dataset；省略则处理 data-sources.json 里的全部。 */
  dataset?: string
  /** videoId 列表文件（每行一个），覆盖默认候选。 */
  ids?: string
  /** 本轮最多请求多少场（全部 dataset 合计），0 = 全部。 */
  limit?: number
  /** 并发，默认 3。 */
  concurrency?: number
  /** 把补到的 videoId 写到文件（每行一个）。 */
  idsOut?: string
  /** 只打印汇总与更新名单（对应旧脚本的 `--quiet`；CLI 上是 `--summary-only`）。 */
  quiet?: boolean
  /** 只列候选，不发请求、不写文件。 */
  dryRun?: boolean
  /** 注入的日志器。 */
  log?: CommandLog
}

export interface VstatsRunResult {
  candidates: number
  picked: string[]
  updated: string[]
  missing: string[]
  skipped: string[]
  failures: { dataset: string, videoId: string, detail: string }[]
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms))
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const current = items[i] as T
    items[i] = items[j] as T
    items[j] = current
  }
  return items
}

function readIds(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
}

function manifestCandidates(source: DatasetSource): Candidate[] {
  const manifestPath = resolve(APP_ROOT, source.manifest)
  if (existsSync(manifestPath)) {
    const manifest = readJson<{ streams?: ManifestSummary[] }>(manifestPath)
    return (manifest.streams ?? [])
      .filter(stream => Boolean(stream.videoId))
      .filter(stream => stream.vstatsViews == null && stream.availability === 'public')
      .map(stream => ({ source, videoId: stream.videoId as string }))
  }

  const dir = resolve(APP_ROOT, source.datapackDir)
  if (!existsSync(dir))
    return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.datapack.json'))
    .map(name => ({ source, videoId: name.slice(0, -'.datapack.json'.length) }))
}

function explicitCandidates(source: DatasetSource, ids: string[]): Candidate[] {
  return ids.map(videoId => ({ source, videoId }))
}

async function probe(videoId: string): Promise<Probe> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`https://www.vstats.jp/video/${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(20_000),
      })
      const html = await response.text()
      if (!response.ok) {
        if (response.status >= 500 && attempt === 0) {
          await sleep(1500)
          continue
        }
        return { kind: 'transient', detail: `HTTP ${response.status}` }
      }
      if (html.length < VSTATS_MIN_HTML_BYTES)
        return { kind: 'missing', detail: `${html.length} bytes` }
      const vstats = parseVstats(html)
      if (vstats.views == null && vstats.avgConcurrent == null)
        return { kind: 'missing', detail: '页面没有统计字段' }
      return { kind: 'ok', vstats }
    }
    catch (error) {
      if (attempt === 0) {
        await sleep(1500)
        continue
      }
      return { kind: 'transient', detail: error instanceof Error ? error.message : String(error) }
    }
  }
  return { kind: 'transient', detail: '重试后仍失败' }
}

function packPath(source: DatasetSource, videoId: string): string {
  return join(resolve(APP_ROOT, source.datapackDir), `${videoId}.datapack.json`)
}

function loadPack(source: DatasetSource, videoId: string): StreamDatapack | null {
  const path = packPath(source, videoId)
  if (!existsSync(path))
    return null
  return readJson<StreamDatapack>(path)
}

function applyVstats(source: DatasetSource, videoId: string, pack: StreamDatapack, vstats: ReturnType<typeof parseVstats>): void {
  const path = packPath(source, videoId)
  pack.vstats = vstats
  pack.derived = {
    ...pack.derived,
    ...deriveVstats(vstats, pack.chat?.total ?? 0, pack.video?.snapshot?.views ?? null),
  }
  writeFileSync(path, `${JSON.stringify(pack, null, 2)}\n`, 'utf8')

  const datapackRel = relative(APP_ROOT, path).replaceAll('\\', '/')
  upsertManifestStream(resolve(APP_ROOT, source.manifest), pack, datapackRel)
}

/**
 * 只请求 VSTATS 单场页并把结果写回本地 pack。
 *
 * 进程内可调用（`data update` 用它替代 spawn）：不读 process.argv、不调用 process.exit，
 * 进度走注入的 `log`，结果从返回值取。
 */
export async function runVstats(options: RunVstatsOptions = {}): Promise<{ exitCode: number, data?: VstatsRunResult }> {
  const log = options.log ?? SILENT_LOG
  const limit = options.limit ?? DEFAULT_LIMIT
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  if (!Number.isInteger(limit) || limit < 0) {
    throw new UsageError('--limit 需要是 >= 0 的整数', {
      hint: '例如 --limit 20，0 表示本轮不限场次',
      context: { option: 'limit', value: limit },
    })
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new UsageError('--concurrency 需要是 >= 1 的整数', {
      hint: '例如 --concurrency 3',
      context: { option: 'concurrency', value: concurrency },
    })
  }
  const quiet = options.quiet === true
  const dryRun = options.dryRun === true

  const sources = readJson<{ datasets?: DatasetSource[] }>(CONFIG_PATH).datasets ?? []
  const selected = options.dataset ? sources.filter(source => source.id === options.dataset) : sources
  if (selected.length === 0) {
    throw new CliError(`找不到 dataset：${options.dataset ?? '(data-sources.json 为空)'}`, {
      code: 'UNKNOWN_DATASET',
      hint: `可用：${sources.map(source => source.id).join(', ') || '(空)'}`,
      context: { dataset: options.dataset ?? null },
    })
  }

  const explicitIds = options.ids ? readIds(resolve(options.ids)) : null
  const candidates: Candidate[] = []
  for (const source of selected) {
    const list = explicitIds ? explicitCandidates(source, explicitIds) : manifestCandidates(source)
    candidates.push(...list)
  }

  const picked = limit > 0 ? shuffle(candidates).slice(0, limit) : shuffle(candidates)
  log.info(`候选 ${candidates.length} · 本轮 ${picked.length}（并发 ${concurrency}）`)

  if (dryRun) {
    for (const candidate of picked)
      log.info(`候选 ${candidate.source.id}/${candidate.videoId}`)
    return {
      exitCode: 0,
      data: {
        candidates: candidates.length,
        picked: picked.map(candidate => `${candidate.source.id}/${candidate.videoId}`),
        updated: [],
        missing: [],
        skipped: [],
        failures: [],
      },
    }
  }

  const updated: string[] = []
  const missing: string[] = []
  const failures: { candidate: Candidate, detail: string }[] = []
  const skipped: string[] = []
  let done = 0

  const queue = [...picked]
  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      const candidate = queue.shift()
      if (!candidate)
        continue
      const label = `${candidate.source.id}/${candidate.videoId}`
      // 本地没有 pack（安静日没恢复）或已经有 VSTATS 时不发请求。
      const pack = loadPack(candidate.source, candidate.videoId)
      if (!pack || pack.vstats) {
        skipped.push(label)
        if (!quiet)
          log.info(`${label} 本地 pack 不存在或已有 VSTATS，跳过`)
        continue
      }

      const result = await probe(candidate.videoId)
      done += 1
      if (result.kind === 'ok') {
        applyVstats(candidate.source, candidate.videoId, pack, result.vstats)
        updated.push(`${candidate.source.id}/${candidate.videoId}`)
        if (!quiet)
          log.info(`${label} 补到（平均同接 ${result.vstats.avgConcurrent ?? '—'} / 播放 ${result.vstats.views ?? '—'}）`)
      }
      else if (result.kind === 'missing') {
        missing.push(label)
        if (!quiet)
          log.info(`${label} 未收录（${result.detail}）`)
      }
      else {
        failures.push({ candidate, detail: result.detail })
        if (!quiet)
          log.info(`${label} 临时失败（${result.detail}）`)
      }
      if (quiet && done % 20 === 0)
        log.info(`进度 ${done}/${picked.length}`)
      if (queue.length > 0)
        await sleep(300)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, picked.length) }, () => worker()))

  if (options.idsOut) {
    const outPath = resolve(options.idsOut)
    writeFileSync(outPath, updated.length > 0 ? `${updated.map(item => item.split('/')[1]).join('\n')}\n` : '', 'utf8')
  }

  log.info(`完成：补到 ${updated.length} / 未收录 ${missing.length} / 临时失败 ${failures.length} / 跳过 ${skipped.length}`)
  if (updated.length > 0 && !quiet) {
    for (const item of updated)
      log.info(`更新 ${item}`)
  }

  // 只有整轮都被临时错误挡住时才让调用方感知；单场失败按「跳过并记录」处理。
  const allTransient = failures.length > 0 && updated.length === 0 && missing.length === 0
  if (allTransient)
    log.error('本轮全部临时失败，稍后重试')

  return {
    exitCode: allTransient ? 1 : 0,
    data: {
      candidates: candidates.length,
      picked: picked.map(candidate => `${candidate.source.id}/${candidate.videoId}`),
      updated,
      missing,
      skipped,
      failures: failures.map(failure => ({
        dataset: failure.candidate.source.id,
        videoId: failure.candidate.videoId,
        detail: failure.detail,
      })),
    },
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** `data vstats`：只补 VSTATS 单场页数据。 */
export const dataVstatsSpec: CommandSpec<VstatsRunResult> = {
  id: 'data.vstats',
  description: '只补 VSTATS 单场页数据（vstats 与派生比值写回本地 pack）',
  details: '只请求 VSTATS 单场页，把 vstats 与派生比值写回本地 pack；不重抓弹幕 / 评论 / 媒体。\n'
    + 'VSTATS 未收录的场次只记「未收录」不算失败；临时失败下轮重试。',
  examples: [
    'bun run ymmt data vstats --dry-run',
    'bun run ymmt data vstats --dataset yuno --limit 5',
    'bun run ymmt data vstats --dataset arale --ids ids.txt --ids-out temp/vstats.txt --json',
  ],
  options: [
    new Option('--dataset <id>', '只处理指定 dataset；默认全部'),
    new Option('--ids <文件>', '指定 videoId 列表（每行一个），覆盖默认候选'),
    new Option('--limit <n>', `本轮最多请求 n 场（全部 dataset 合计），默认 ${DEFAULT_LIMIT}；0 = 全部`).default(DEFAULT_LIMIT),
    new Option('--concurrency <n>', `并发，默认 ${DEFAULT_CONCURRENCY}`).default(DEFAULT_CONCURRENCY),
    new Option('--ids-out <文件>', '把补到的 videoId 写到文件（每行一个）'),
    new Option('--summary-only', '只打印汇总与更新名单（旧的 --quiet；全局 --quiet 会连汇总一起静音）'),
  ],
  async run(ctx) {
    const result = await runVstats({
      dataset: optionalString(ctx.options.dataset),
      ids: optionalString(ctx.options.ids),
      limit: ctx.integer('limit', DEFAULT_LIMIT, 0),
      concurrency: ctx.integer('concurrency', DEFAULT_CONCURRENCY, 1),
      idsOut: optionalString(ctx.options.idsOut),
      quiet: ctx.flag('summaryOnly'),
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    return { exitCode: result.exitCode, data: result.data }
  },
}
