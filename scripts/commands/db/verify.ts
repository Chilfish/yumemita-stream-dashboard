import { readdirSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import process from 'node:process'
import { eq, inArray, sql } from 'drizzle-orm'
import { aggregateDataset, type StreamRow } from '../src/lib/aggregate.ts'
import { runBatch } from '../src/db/batch.ts'
import { createDb } from '../src/db/connection.ts'
import { computeDatasetPublicTotals } from '../src/db/queries/dataset-totals.ts'
import {
  comments,
  datasetInsights,
  paidEvents,
  streamAuthors,
  streams,
  streamWords,
} from '../src/db/schema.ts'
import type { CurrencyTotals, StreamDatapack } from '../src/types/datapack.ts'
import { buildStreamSummary } from './lib/dataset-manifest.ts'
import { loadEnvFiles, requireEnv } from './lib/env.ts'
import { jsonEqual } from './lib/json-equal.ts'

interface Args {
  dataset?: string
  idsFile?: string
  limit?: number
}

interface Problem {
  scope: string
  message: string
}

function parseArgs(argv: string[]): Args {
  const args: Args = {}
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dataset') args.dataset = argv[++index]
    else if (argv[index] === '--ids') args.idsFile = argv[++index]
    else if (argv[index] === '--limit') args.limit = Number(argv[++index])
  }
  return args
}

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

function readLocal(
  datasetId: string,
  idsFile?: Set<string>,
): { file: string, pack: StreamDatapack }[] {
  const dir = resolve('data', datasetId)
  return readdirSync(dir)
    .filter(name => name.endsWith('.datapack.json'))
    .filter(name => !idsFile || idsFile.has(basename(name, '.datapack.json')))
    .sort()
    .map(name => ({
      file: resolve(dir, name),
      pack: JSON.parse(readFileSync(resolve(dir, name), 'utf8')) as StreamDatapack,
    }))
}

async function main(): Promise<void> {
  loadEnvFiles()
  const args = parseArgs(process.argv.slice(2))
  const sources = JSON.parse(readFileSync('data-sources.json', 'utf8')) as {
    datasets: { id: string }[]
  }
  const selected = sources.datasets.filter(item => !args.dataset || item.id === args.dataset)
  const idsFile = args.idsFile
    ? new Set(readFileSync(args.idsFile, 'utf8').split(/\s+/).filter(Boolean))
    : undefined
  const db = createDb(requireEnv('DATABASE_URL'))
  const problems: Problem[] = []
  let checked = 0

  for (const source of selected) {
    const all = readLocal(source.id, idsFile)
    const local = args.limit ? all.slice(0, args.limit) : all
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

    if (!args.limit) {
      const [insight] = await db
        .select()
        .from(datasetInsights)
        .where(eq(datasetInsights.datasetId, source.id))
      const expected = aggregateDataset(
        all.map(({ file, pack }) => ({
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
      console.log(`[verify] ${source.id}: 小批量模式，跳过 dataset_insights 对比`)
    }
  }

  console.log(JSON.stringify({ checked, problems: problems.length }, null, 2))
  for (const problem of problems.slice(0, 20)) {
    console.error(`✗ ${problem.scope}: ${problem.message}`)
  }
  if (problems.length > 0) process.exitCode = 1
}

await main()
