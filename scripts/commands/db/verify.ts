/**
 * 数据库与本地 pack 字段级对账：场次、付费事件、评论、词表、作者与 insights。
 *
 * 读本地 `data/<dataset>/*.datapack.json`，与数据库逐项比对；有差异时退出码 1。
 * `--limit` 走小批量模式，跳过 `dataset_insights` 对比。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { Option } from 'commander'
import { eq, inArray, sql } from 'drizzle-orm'
import type { CommandSpec } from '@scripts/lib/cli/runtime.ts'
import { requireEnvVar, UsageError } from '@scripts/lib/cli/exit.ts'
import type { Logger } from '@scripts/lib/cli/logger.ts'
import { aggregateDataset, type StreamRow } from '@/lib/aggregate.ts'
import { runBatch } from '@/db/batch.ts'
import { createDb } from '@/db/connection.ts'
import { computeDatasetPublicTotals } from '@/db/queries/dataset-totals.ts'
import {
  comments,
  datasetInsights,
  paidEvents,
  streamAuthors,
  streams,
  streamWords,
} from '@/db/schema.ts'
import type { CurrencyTotals, StreamDatapack } from '@/types/datapack.ts'
import { buildStreamSummary } from '@scripts/lib/dataset-manifest.ts'
import { jsonEqual } from '@scripts/lib/json-equal.ts'

/** 只取命令需要的日志通道；默认是空操作，测试与被其它脚本调用时都不产生输出。 */
export type VerifyLog = Pick<Logger, 'info' | 'warn' | 'error' | 'line'>

const NOOP_LOG: VerifyLog = { info: () => {}, warn: () => {}, error: () => {}, line: () => {} }

export interface VerifyOptions {
  /** 只处理指定 dataset；省略会处理 data-sources.json 里的全部成员。 */
  dataset?: string
  /** 只处理文件里列出的 videoId（每行一个）。 */
  idsFile?: string
  /** 每个 dataset 最多处理前 n 场；有值时跳过 dataset_insights 对比。 */
  limit?: number
  log?: VerifyLog
}

export interface VerifyResult {
  exitCode: number
  data: {
    checked: number
    problems: number
  }
}

interface Problem {
  scope: string
  message: string
}

const DATABASE_HINT = '在 .dev.vars 配置 DATABASE_URL；本地可先运行 bun run ymmt dev db'

function sameTotals(a: CurrencyTotals, b: CurrencyTotals): boolean {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])
  for (const key of keys) {
    const left = a?.[key]
    const right = b?.[key]
    if ((left?.count ?? 0) !== (right?.count ?? 0)) return false
    if (Math.abs((left?.amount ?? 0) - (right?.amount ?? 0)) > 1e-9) return false
  }
  return true
}

function readLocal(datasetId: string): { file: string, pack: StreamDatapack }[] {
  const dir = resolve('data', datasetId)
  return readdirSync(dir)
    .filter(name => name.endsWith('.datapack.json'))
    .sort()
    .map(name => ({
      file: resolve(dir, name),
      pack: JSON.parse(readFileSync(resolve(dir, name), 'utf8')) as StreamDatapack,
    }))
}

/**
 * 逐场对账；差异明细写日志，返回值只有计数。
 *
 * 单条差异只记录、不中断，剩余场次照旧比对。
 */
export async function runVerify(options: VerifyOptions = {}): Promise<VerifyResult> {
  const log = options.log ?? NOOP_LOG
  const sources = JSON.parse(readFileSync('data-sources.json', 'utf8')) as {
    datasets: { id: string }[]
  }
  const selected = sources.datasets.filter(item => !options.dataset || item.id === options.dataset)
  if (selected.length === 0) {
    throw new UsageError(`找不到 dataset：${options.dataset}`, {
      code: 'UNKNOWN_DATASET',
      hint: '查可用成员：jq -r ".datasets[].id" data-sources.json，再去掉拼错的 --dataset',
      context: { dataset: options.dataset },
    })
  }
  const idsFile = options.idsFile
    ? new Set(readFileSync(options.idsFile, 'utf8').split(/\s+/).filter(Boolean))
    : undefined
  const db = createDb(requireEnvVar('DATABASE_URL', DATABASE_HINT))
  const problems: Problem[] = []
  let checked = 0

  for (const source of selected) {
    // `--ids` 只收窄逐场对账；insights 永远是全量重算，不能用子集对比。
    const every = readLocal(source.id)
    const scoped = idsFile ? every.filter(item => idsFile.has(item.pack.video.id)) : every
    const local = options.limit ? scoped.slice(0, options.limit) : scoped
    const videoIds = local.map(item => item.pack.video.id)
    if (videoIds.length === 0) continue

    const dbRows = await db
      .select({
        id: streams.id,
        videoId: streams.videoId,
        chatTotal: streams.chatTotal,
        superchats: streams.superchats,
        scTotalsByCurrency: streams.scTotalsByCurrency,
      })
      .from(streams)
      .where(eq(streams.datasetId, source.id))
    const scopeIds = new Set(videoIds)
    const dbRowsInScope = dbRows.filter(row => scopeIds.has(row.videoId))
    if (dbRowsInScope.length !== local.length) {
      problems.push({
        scope: source.id,
        message: `范围内 streams 行数 ${dbRowsInScope.length}，本地 ${local.length}`,
      })
    }
    const byVideo = new Map(dbRowsInScope.map(row => [row.videoId, row]))
    const dbIds = dbRowsInScope.map(row => row.id)

    const [paidCounts, commentCounts, wordCounts, authorTotals] = await runBatch<[
      { streamId: number, kind: string, count: number }[],
      { streamId: number, count: number }[],
      { streamId: number, count: number }[],
      { streamId: number, messages: number, authors: number }[],
    ]>(db, [
      db
        .select({
          streamId: paidEvents.streamId,
          kind: paidEvents.kind,
          count: sql<number>`count(*)::int`,
        })
        .from(paidEvents)
        .where(inArray(paidEvents.streamId, dbIds))
        .groupBy(paidEvents.streamId, paidEvents.kind),
      db
        .select({ streamId: comments.streamId, count: sql<number>`count(*)::int` })
        .from(comments)
        .where(inArray(comments.streamId, dbIds))
        .groupBy(comments.streamId),
      db
        .select({ streamId: streamWords.streamId, count: sql<number>`count(*)::int` })
        .from(streamWords)
        .where(inArray(streamWords.streamId, dbIds))
        .groupBy(streamWords.streamId),
      db
        .select({
          streamId: streamAuthors.streamId,
          messages: sql<number>`coalesce(sum(${streamAuthors.messages}), 0)::int`,
          authors: sql<number>`count(*)::int`,
        })
        .from(streamAuthors)
        .where(inArray(streamAuthors.streamId, dbIds))
        .groupBy(streamAuthors.streamId),
    ])

    const paidByStream = new Map<string, Map<string, number>>()
    for (const row of paidCounts) {
      const key = String(row.streamId)
      const bucket = paidByStream.get(key) ?? new Map<string, number>()
      bucket.set(row.kind, row.count)
      paidByStream.set(key, bucket)
    }

    const commentsByStream = new Map(commentCounts.map(row => [String(row.streamId), row.count]))
    const wordsByStream = new Map(wordCounts.map(row => [String(row.streamId), row.count]))
    const authorsByStream = new Map(authorTotals.map(row => [String(row.streamId), row]))

    for (const { pack } of local) {
      const videoId = pack.video.id
      const row = byVideo.get(videoId)
      checked += 1
      if (!row) {
        problems.push({ scope: `${source.id}/${videoId}`, message: '数据库缺少该场' })
        continue
      }

      const scope = `${source.id}/${videoId}`
      if (row.chatTotal !== pack.chat.total) {
        problems.push({ scope, message: `chat_total ${row.chatTotal} != ${pack.chat.total}` })
      }
      if (row.superchats !== pack.chat.paid.superchats.length) {
        problems.push({ scope, message: `superchats ${row.superchats} != ${pack.chat.paid.superchats.length}` })
      }
      if (!sameTotals(row.scTotalsByCurrency as CurrencyTotals, pack.chat.paid.scTotalsByCurrency)) {
        problems.push({ scope, message: 'sc_totals_by_currency 不一致' })
      }

      const paid = paidByStream.get(String(row.id))
      const expectedPaid = {
        superchat: pack.chat.paid.superchats.length,
        sticker: pack.chat.paid.stickers.length,
        membership: pack.chat.paid.memberships.length,
        gift: pack.chat.paid.gifts?.length ?? 0,
      }
      for (const [kind, expected] of Object.entries(expectedPaid)) {
        const actual = paid?.get(kind) ?? 0
        if (actual !== expected) {
          problems.push({ scope, message: `paid_events ${kind} ${actual} != ${expected}` })
        }
      }

      const expectedComments = pack.comments?.items.length ?? 0
      const actualComments = commentsByStream.get(String(row.id)) ?? 0
      if (actualComments !== expectedComments) {
        problems.push({ scope, message: `comments ${actualComments} != ${expectedComments}` })
      }

      if (pack.chat.authors?.length) {
        const expectedWords = new Set(
          Object.entries(pack.chat.wordCounts ?? {})
            .filter(([, count]) => count >= 3)
            .map(([word]) => word),
        )
        const actualWords = wordsByStream.get(String(row.id)) ?? 0
        if (actualWords > expectedWords.size) {
          problems.push({ scope, message: `stream_words ${actualWords} > 预期上限 ${expectedWords.size}` })
        }

        const authorStats = authorsByStream.get(String(row.id))
        if ((authorStats?.messages ?? 0) !== pack.chat.total) {
          problems.push({
            scope,
            message: `stream_authors.messages 之和 ${authorStats?.messages ?? 0} != chat.total ${pack.chat.total}`,
          })
        }
        if ((authorStats?.authors ?? 0) !== pack.chat.uniqueAuthors) {
          problems.push({
            scope,
            message: `stream_authors 作者数 ${authorStats?.authors ?? 0} != uniqueAuthors ${pack.chat.uniqueAuthors}`,
          })
        }
      }
    }

    if (!options.limit) {
      const [insight] = await db
        .select()
        .from(datasetInsights)
        .where(eq(datasetInsights.datasetId, source.id))
      const expected = aggregateDataset(
        every.map(({ file, pack }) => ({
          summary: buildStreamSummary(pack, `data/${source.id}/${basename(file)}`) as StreamRow['summary'],
          pack,
        })),
      )
      if (!insight) {
        problems.push({ scope: source.id, message: '缺少 dataset_insights' })
      }
      else if (!jsonEqual(insight.totals, expected)) {
        problems.push({ scope: source.id, message: 'dataset_insights.totals 与重算结果不一致' })
      }

      // 页面汇总读 public_totals；它必须与数据库当前状态一致。
      const expectedPublic = await computeDatasetPublicTotals(db, source.id)
      if (!insight?.publicTotals) {
        problems.push({ scope: source.id, message: '缺少 dataset_insights.public_totals' })
      }
      else if (!jsonEqual(insight.publicTotals, expectedPublic)) {
        problems.push({ scope: source.id, message: 'dataset_insights.public_totals 与数据库重算结果不一致' })
      }
    }
    else {
      log.info(`[verify] ${source.id}: 小批量模式，跳过 dataset_insights 对比`)
    }
  }

  for (const problem of problems.slice(0, 20)) {
    log.error(`✗ ${problem.scope}: ${problem.message}`)
  }

  return { exitCode: problems.length > 0 ? 1 : 0, data: { checked, problems: problems.length } }
}

/** 数据库与本地 pack 字段级对账；有差异时退出码 1。 */
export const dbVerifySpec: CommandSpec = {
  id: 'db.verify',
  description: '数据库与本地 pack 字段级对账',
  details: '逐场比对 chat_total / 付费事件 / 评论 / 词表 / 作者，并重算 dataset_insights。\n'
    + '有差异时退出码 1，前 20 条明细写 stderr。`--limit` 走小批量模式，跳过 insights 对比。',
  examples: [
    'bun run ymmt db verify',
    'bun run ymmt db verify --dataset nonoka',
    'bun run ymmt db verify --dataset nonoka --ids ids.txt',
    'bun run ymmt db verify --limit 20 --json',
  ],
  options: [
    new Option('--dataset <id>', '只处理指定 dataset'),
    new Option('--ids <文件>', '只处理文件里列出的 videoId（每行一个）'),
    new Option('--limit <n>', '每个 dataset 最多处理前 n 场；跳过 insights 对比'),
  ],
  async run(ctx) {
    const result = await runVerify({
      ...(typeof ctx.options.dataset === 'string' ? { dataset: ctx.options.dataset } : {}),
      ...(typeof ctx.options.ids === 'string' ? { idsFile: ctx.options.ids } : {}),
      ...(ctx.options.limit === undefined ? {} : { limit: ctx.integer('limit', 1, 1) }),
      log: ctx.log,
    })
    ctx.log.line(`对账完成：检查 ${result.data.checked} 场，问题 ${result.data.problems} 个`)
    return { exitCode: result.exitCode, data: result.data }
  },
}
