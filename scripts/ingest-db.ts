import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { basename, resolve } from 'node:path'
import process from 'node:process'
import { aggregateDataset, type StreamRow } from '../src/lib/aggregate.ts'
import { isStopword } from '../src/lib/stopwords.ts'
import { createDb, createWriteDb } from '../src/db/connection.ts'
import { computeDatasetPublicTotals } from '../src/db/queries/dataset-totals.ts'
import {
  authors,
  comments,
  datasetInsights,
  datasets,
  ingestReports,
  paidEvents,
  scheduledStreams,
  streamAuthors,
  streamDetails,
  streams,
  streamWords,
} from '../src/db/schema.ts'
import type { StreamDatapack } from '../src/types/datapack.ts'
import { buildStreamSummary } from './lib/dataset-manifest.ts'
import { loadEnvFiles, requireEnv } from './lib/env.ts'
import { syncTranscripts } from './lib/transcripts-db.ts'
import { backfillSupersededSchedules } from './lib/schedule-match.ts'

interface DataSource {
  id: string
  label: string
  color?: string
  avatar?: string
  channelId?: string
  subject?: string
  scope?: string
  note?: string
}

interface Args {
  dataset?: string
  idsFile?: string
  limit?: number
  all: boolean
  dryRun: boolean
  force: boolean
  newOnly: boolean
  batchSize: number
  help: boolean
}

const USAGE = `用法：bun scripts/ingest-db.ts [选项]

从 data/<dataset>/*.datapack.json 投影到 PostgreSQL；只处理本地 pack。

选项：
  --dataset <id>     只处理指定 dataset；省略会处理全部成员
  --ids <文件>       只处理文件里列出的 videoId（每行一个）
  --limit <n>        每个 dataset 最多处理前 n 份 pack；跳过 insights 重算
  --force            内容 hash 不变也重写
  --new-only         只插入数据库里还没有的场次，不改写已有行（避免大批量回写）
  --all              等同上 --force（历史参数）
  --batch-size <n>   每处理 n 份打印进度，默认 50
  --dry-run          只校验 pack，不连数据库
  -h, --help         显示本帮助

注意：未识别的参数会被忽略；补数据时务必带 --dataset / --ids，避免误跑全量。`

interface DatasetReport {
  id: string
  total: number
  processed: number
  skipped: number
  failed: number
  newIds: string[]
  forceIds: string[]
  errors: { videoId: string, message: string }[]
}

function parseArgs(argv: string[]): Args {
  const args: Args = { all: false, dryRun: false, force: false, newOnly: false, batchSize: 50, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dataset') args.dataset = argv[++index]
    else if (arg === '--ids') args.idsFile = argv[++index]
    else if (arg === '--limit') args.limit = Number(argv[++index])
    else if (arg === '--batch-size') args.batchSize = Math.max(1, Number(argv[++index]) || 50)
    else if (arg === '--all') { args.all = true; args.force = true }
    else if (arg === '--force') args.force = true
    else if (arg === '--new-only') args.newOnly = true
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else console.warn(`[ingest] 忽略未知参数：${arg}`)
  }
  return args
}

function contentHash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function hashName(name: string): string {
  return `name:${createHash('sha1').update(name).digest('hex').slice(0, 16)}`
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function numeric(value: unknown): string | null {
  const number = toNumber(value)
  return number == null ? null : String(number)
}

function toTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time)
}

function dateKey(value: string | null | undefined): string | null {
  if (!value) return null
  const key = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

function readPacks(datasetId: string, idsFile?: Set<string>): { file: string, raw: string }[] {
  const dir = resolve('data', datasetId)
  return readdirSync(dir)
    .filter(name => name.endsWith('.datapack.json'))
    .filter(name => !idsFile || idsFile.has(basename(name, '.datapack.json')))
    .sort()
    .map(name => {
      const file = resolve(dir, name)
      return { file, raw: readFileSync(file, 'utf8') }
    })
}

function validatePack(pack: StreamDatapack, file: string): string[] {
  const errors: string[] = []
  const expected = basename(file, '.datapack.json')
  if (!pack.video?.id) errors.push('缺少 video.id')
  else if (pack.video.id !== expected) errors.push(`video.id (${pack.video.id}) 与文件名 (${expected}) 不一致`)
  if (typeof pack.chat?.total !== 'number') errors.push('缺少 chat.total')
  if (!pack.chat?.byKind) errors.push('缺少 chat.byKind')
  if (!pack.chat?.density) errors.push('缺少 chat.density')
  if (!pack.chat?.paid) errors.push('缺少 chat.paid')
  return errors
}

function authorKey(authorId: string | null | undefined, name: string): string {
  return authorId || hashName(name)
}

interface AuthorAggregate {
  authorId: string
  name: string
  messages: number
  superchats: number
  stickers: number
  memberships: number
}

function collectAuthors(pack: StreamDatapack): AuthorAggregate[] {
  if (pack.chat.authors?.length) {
    return pack.chat.authors.map(author => ({
      authorId: authorKey(author.authorId, author.author),
      name: author.author,
      messages: author.messages,
      superchats: author.superchats,
      stickers: author.stickers,
      memberships: author.memberships,
    }))
  }

  return (pack.chat.topAuthors ?? []).map(author => ({
    authorId: authorKey(author.authorId, author.author),
    name: author.author,
    messages: author.messages,
    superchats: author.superchats,
    stickers: author.stickers,
    memberships: author.memberships,
  }))
}

function collectWords(pack: StreamDatapack): { word: string, count: number }[] {
  const source = pack.chat.wordCounts
    ? Object.entries(pack.chat.wordCounts).map(([word, count]) => ({ word, count }))
    : pack.chat.topWords

  return source
    .filter(entry => entry.count >= 3 && !isStopword(entry.word))
    .sort((a, b) => b.count - a.count)
}

function buildInsights(packs: { pack: StreamDatapack, rel: string }[]) {
  const rows: StreamRow[] = packs.map(({ pack, rel }) => ({
    summary: buildStreamSummary(pack, rel) as StreamRow['summary'],
    pack,
  }))
  return aggregateDataset(rows)
}

async function main(): Promise<void> {
  loadEnvFiles()
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    return
  }
  const sources = JSON.parse(readFileSync('data-sources.json', 'utf8')) as { datasets: DataSource[] }
  const selected = sources.datasets.filter(item => !args.dataset || item.id === args.dataset)
  if (selected.length === 0) throw new Error(`找不到 dataset: ${args.dataset}`)

  const idsFile = args.idsFile
    ? new Set(readFileSync(args.idsFile, 'utf8').split(/\s+/).filter(Boolean))
    : undefined

  const startedAt = new Date()
  const reports: DatasetReport[] = []
  let db: ReturnType<typeof createWriteDb>['db'] | null = null
  let pool: ReturnType<typeof createWriteDb>['pool'] | null = null
  let readDb: ReturnType<typeof createDb> | null = null

  if (!args.dryRun) {
    const url = requireEnv('DATABASE_URL')
    const connection = createWriteDb(url)
    db = connection.db
    pool = connection.pool
    // 汇总从入库后的数据库状态重算；只在离线 ingest 里读整份明细。
    readDb = createDb(url)
  }

  let batchId: number | null = null
  if (db) {
    const [report] = await db.insert(ingestReports).values({
      startedAt,
      status: 'running',
      datasets: [],
      newIds: [],
      forceIds: [],
      failures: 0,
      structural: false,
      notes: args.dryRun ? 'dry-run' : null,
    }).returning({ id: ingestReports.id })
    batchId = report?.id ?? null
  }

  try {
    for (const source of selected) {
      const report: DatasetReport = {
        id: source.id,
        total: 0,
        processed: 0,
        skipped: 0,
        failed: 0,
        newIds: [],
        forceIds: [],
        errors: [],
      }
      reports.push(report)

      const allPacks = readPacks(source.id, idsFile)
      const packs = args.limit ? allPacks.slice(0, args.limit) : allPacks
      report.total = packs.length
      console.log(`[ingest] ${source.id}: ${packs.length} packs`)

      if (!db) {
        for (const { file, raw } of packs) {
          const pack = JSON.parse(raw) as StreamDatapack
          const errors = validatePack(pack, file)
          if (errors.length) {
            report.failed += 1
            report.errors.push({ videoId: basename(file, '.datapack.json'), message: errors.join('; ') })
          }
          else {
            report.processed += 1
            report.newIds.push(pack.video.id)
          }
        }
        continue
      }

      await db.insert(datasets).values({
        id: source.id,
        label: source.label,
        color: source.color ?? null,
        avatarKey: source.avatar ?? null,
        channelId: source.channelId ?? null,
        subject: source.subject ?? null,
        scope: source.scope ?? null,
        note: source.note ?? null,
      }).onConflictDoUpdate({
        target: datasets.id,
        set: {
          label: source.label,
          color: source.color ?? null,
          avatarKey: source.avatar ?? null,
          channelId: source.channelId ?? null,
          subject: source.subject ?? null,
          scope: source.scope ?? null,
          note: source.note ?? null,
          updatedAt: new Date(),
        },
      })

      const existingRows = await db
        .select({ videoId: streams.videoId, contentHash: streams.contentHash })
        .from(streams)
        .where(eq(streams.datasetId, source.id))
      const existing = new Map(existingRows.map(row => [row.videoId, row.contentHash]))

      let changed = false
      for (const { file, raw } of packs) {
        const videoId = basename(file, '.datapack.json')
        let pack: StreamDatapack
        try {
          pack = JSON.parse(raw) as StreamDatapack
        }
        catch (error) {
          report.failed += 1
          report.errors.push({ videoId, message: `JSON 解析失败: ${(error as Error).message}` })
          continue
        }

        const errors = validatePack(pack, file)
        if (errors.length) {
          report.failed += 1
          report.errors.push({ videoId, message: errors.join('; ') })
          continue
        }

        const previous = existing.get(videoId)
        if (args.newOnly && previous != null) {
          report.skipped += 1
          continue
        }
        const hash = contentHash(raw)
        if (!args.force && previous === hash) {
          report.skipped += 1
          continue
        }
        if (previous == null) report.newIds.push(videoId)
        else report.forceIds.push(videoId)

        try {
          await ingestPack(db, source, pack, hash, batchId)
          report.processed += 1
          changed = true
        }
        catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const cause = error instanceof Error && error.cause instanceof Error ? `：${error.cause.message}` : ''
          report.failed += 1
          report.errors.push({ videoId, message })
          console.warn(`[ingest] ${source.id}/${videoId} 失败：${message}${cause}`)
        }

        const done = report.processed + report.skipped + report.failed
        if (done > 0 && done % args.batchSize === 0) {
          console.log(`[ingest] ${source.id}: ${done}/${packs.length}（失败 ${report.failed}）`)
        }
      }

      // 上次可能在写完 streams 后中断，重跑时所有 pack 都会 skip。
      // 用数据库里的实际场次数判断 insights 是否过期；一次查询同时取行数和现有汇总。
      const [insightRow] = await db
        .select({
          totals: datasetInsights.totals,
          publicTotals: datasetInsights.publicTotals,
          streamCount: sql<number>`(select count(*)::int from ${streams} where ${streams.datasetId} = ${source.id})`,
        })
        .from(datasetInsights)
        .where(eq(datasetInsights.datasetId, source.id))
        .limit(1)
      const insightTotals = (insightRow?.totals ?? {}) as { streamCount?: unknown }
      const insightCount = typeof insightTotals.streamCount === 'number' ? insightTotals.streamCount : null
      // 没有 public_totals 说明是旧数据；没有 insight 行时也要补算。
      const insightsStale = !insightRow
        || insightRow.publicTotals == null
        || insightCount !== Number(insightRow.streamCount ?? 0)

      if (args.limit) {
        console.log(`[ingest] ${source.id}: 小批量模式，跳过 dataset_insights 重算`)
      }
      else if (changed || args.all || insightsStale) {
        const all = readPacks(source.id).map(({ file, raw }) => ({
          pack: JSON.parse(raw) as StreamDatapack,
          rel: `data/${source.id}/${basename(file)}`,
        }))
        const totals = buildInsights(all)
        const publicTotals = await computeDatasetPublicTotals(readDb!, source.id)
        await db.insert(datasetInsights).values({
          datasetId: source.id,
          totals,
          publicTotals,
          aggregation: totals.aggregation ?? null,
          generatedAt: new Date(),
        }).onConflictDoUpdate({
          target: datasetInsights.datasetId,
          set: { totals, publicTotals, aggregation: totals.aggregation ?? null, generatedAt: new Date() },
        })
        console.log(
          `[ingest] ${source.id}: insights 已更新（${all.length} 场；public_totals ${publicTotals.streamCount} 场 / ${JSON.stringify(publicTotals).length} B）`,
        )
      }

      const transcriptCount = await syncTranscripts(db, source.id)
      if (transcriptCount > 0) {
        console.log(`[ingest] ${source.id}: 逐字稿元数据 ${transcriptCount} 篇`)
      }

      const matchedSchedules = await backfillSupersededSchedules(db, source.id)
      if (matchedSchedules > 0) {
        console.log(`[ingest] ${source.id}: 回填日程匹配 ${matchedSchedules} 条`)
      }
    }

    const failures = reports.reduce((sum, report) => sum + report.failed, 0)
    const processed = reports.reduce((sum, report) => sum + report.processed, 0)
    const status = failures === 0 ? 'success' : processed === 0 ? 'failed' : 'partial'

    if (db && batchId != null) {
      await db.update(ingestReports).set({
        finishedAt: new Date(),
        status,
        datasets: reports,
        newIds: reports.flatMap(report => report.newIds),
        forceIds: reports.flatMap(report => report.forceIds),
        failures,
      }).where(eq(ingestReports.id, batchId))
    }

    console.log(JSON.stringify({
      status,
      dryRun: args.dryRun,
      processed,
      skipped: reports.reduce((sum, report) => sum + report.skipped, 0),
      failures,
      datasets: reports.map(report => ({
        id: report.id,
        processed: report.processed,
        skipped: report.skipped,
        failed: report.failed,
      })),
    }, null, 2))

    if (failures > 0) process.exitCode = 1
  }
  catch (error) {
    // 异常中断也要关闭报告，避免永远停留在 running。
    if (db && batchId != null) {
      await db.update(ingestReports).set({
        finishedAt: new Date(),
        status: 'failed',
        failures: 1,
        notes: error instanceof Error ? error.message.slice(0, 500) : 'aborted',
      }).where(eq(ingestReports.id, batchId)).catch(() => undefined)
    }
    throw error
  }
  finally {
    await pool?.end()
  }
}

async function ingestPack(
  db: NonNullable<ReturnType<typeof createWriteDb>['db']>,
  source: DataSource,
  pack: StreamDatapack,
  hash: string,
  batchId: number | null,
): Promise<void> {
  const video = pack.video
  const chat = pack.chat
  const startedAt = toTimestamp(video.startedAt)

  await db.transaction(async (tx) => {
    const [row] = await tx.insert(streams).values({
      datasetId: source.id,
      videoId: video.id,
      title: video.title ?? '',
      url: video.url ?? `https://www.youtube.com/watch?v=${video.id}`,
      date: dateKey(video.startedAt),
      startedAt,
      endedAt: toTimestamp(video.endedAt),
      durationSec: toNumber(video.durationSec),
      durationHms: video.durationHms ?? null,
      availability: video.availability ?? null,
      avgConcurrent: numeric(pack.vstats?.avgConcurrent),
      maxConcurrent: toNumber(pack.vstats?.maxConcurrent),
      maxConcurrentAt: pack.vstats?.maxConcurrentAt ?? null,
      watchTimeHours: numeric(pack.vstats?.watchTimeHours),
      vstatsViews: toNumber(pack.vstats?.views),
      vstatsLikes: toNumber(pack.vstats?.likes),
      snapshotViews: toNumber(video.snapshot?.views),
      snapshotLikes: toNumber(video.snapshot?.likes),
      snapshotComments: toNumber(video.snapshot?.comments),
      chatTotal: chat.total,
      chatByKind: chat.byKind,
      pureEmojiOnly: chat.pureEmojiOnly,
      uniqueAuthors: chat.uniqueAuthors,
      superchats: chat.paid.superchats.length,
      stickers: chat.paid.stickers.length,
      memberships: chat.paid.memberships.length,
      gifts: chat.paid.gifts?.length ?? 0,
      giftedMemberships: (chat.paid.gifts ?? []).reduce((sum, gift) => sum + (gift.count ?? 0), 0),
      scTotalsByCurrency: chat.paid.scTotalsByCurrency,
      commentsCaptured: pack.comments?.total ?? null,
      chatPer1000AvgViewers: numeric(pack.derived?.chatPer1000AvgViewers),
      likesPer1000Views: numeric(pack.derived?.likesPer1000Views),
      scPerHour: numeric(pack.derived?.scPerHour),
      paidSharePct: numeric(pack.chat.paid.paidSharePct),
      thumbnailKey: video.id && video.thumbnail ? `thumbs/${video.id}.jpg` : null,
      sourceGeneratedAt: toTimestamp(pack.generatedAt),
      sourceSchema: pack.schema,
      contentHash: hash,
      ingestBatchId: batchId,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [streams.datasetId, streams.videoId],
      set: {
        title: video.title ?? '',
        url: video.url ?? `https://www.youtube.com/watch?v=${video.id}`,
        date: dateKey(video.startedAt),
        startedAt,
        endedAt: toTimestamp(video.endedAt),
        durationSec: toNumber(video.durationSec),
        durationHms: video.durationHms ?? null,
        availability: video.availability ?? null,
        avgConcurrent: numeric(pack.vstats?.avgConcurrent),
        maxConcurrent: toNumber(pack.vstats?.maxConcurrent),
        maxConcurrentAt: pack.vstats?.maxConcurrentAt ?? null,
        watchTimeHours: numeric(pack.vstats?.watchTimeHours),
        vstatsViews: toNumber(pack.vstats?.views),
        vstatsLikes: toNumber(pack.vstats?.likes),
        snapshotViews: toNumber(video.snapshot?.views),
        snapshotLikes: toNumber(video.snapshot?.likes),
        snapshotComments: toNumber(video.snapshot?.comments),
        chatTotal: chat.total,
        chatByKind: chat.byKind,
        pureEmojiOnly: chat.pureEmojiOnly,
        uniqueAuthors: chat.uniqueAuthors,
        superchats: chat.paid.superchats.length,
        stickers: chat.paid.stickers.length,
        memberships: chat.paid.memberships.length,
        gifts: chat.paid.gifts?.length ?? 0,
        giftedMemberships: (chat.paid.gifts ?? []).reduce((sum, gift) => sum + (gift.count ?? 0), 0),
        scTotalsByCurrency: chat.paid.scTotalsByCurrency,
        commentsCaptured: pack.comments?.total ?? null,
        chatPer1000AvgViewers: numeric(pack.derived?.chatPer1000AvgViewers),
        likesPer1000Views: numeric(pack.derived?.likesPer1000Views),
        scPerHour: numeric(pack.derived?.scPerHour),
        paidSharePct: numeric(pack.chat.paid.paidSharePct),
        thumbnailKey: video.id && video.thumbnail ? `thumbs/${video.id}.jpg` : null,
        sourceGeneratedAt: toTimestamp(pack.generatedAt),
        sourceSchema: pack.schema,
        contentHash: hash,
        ingestBatchId: batchId,
        updatedAt: new Date(),
      },
    }).returning({ id: streams.id })

    if (!row) throw new Error('stream upsert 未返回 id')
    const streamId = row.id

    await tx.delete(streamDetails).where(eq(streamDetails.streamId, streamId))
    await tx.delete(paidEvents).where(eq(paidEvents.streamId, streamId))
    await tx.delete(comments).where(eq(comments.streamId, streamId))
    await tx.delete(streamAuthors).where(eq(streamAuthors.streamId, streamId))
    await tx.delete(streamWords).where(eq(streamWords.streamId, streamId))

    await tx.insert(streamDetails).values({
      streamId,
      density: chat.density,
      coveragePct: numeric(chat.coveragePct),
      timeRange: chat.timeRange,
      badges: chat.badges,
      hashtags: chat.hashtags,
      emojiKinds: chat.emojiKinds,
      ownerChats: chat.ownerChats ?? [],
      emojis: chat.emojis ?? [],
      events: chat.events ?? [],
      videoExtra: {
        description: video.description,
        links: video.links,
        chapters: video.chapters,
        captionsJa: video.captionsJa,
        hasLiveChatReplay: video.hasLiveChatReplay,
        liveStatus: video.liveStatus,
        publishedAt: video.publishedAt,
        channelId: video.channelId,
        channelName: video.channelName,
        channelUrl: video.channelUrl,
        channelFollowersAtCapture: video.channelFollowersAtCapture,
        thumbnail: video.thumbnail,
        snapshot: video.snapshot,
      },
    })

    const paid = [
      ...chat.paid.superchats.map(item => ({
        streamId,
        kind: 'superchat',
        at: toTimestamp(item.at),
        author: item.author,
        authorId: null,
        amountText: item.amountText,
        currency: item.currency,
        amount: numeric(item.amount),
        message: item.message,
        emojis: item.emojis ?? null,
      })),
      ...chat.paid.stickers.map(item => ({
        streamId,
        kind: 'sticker',
        at: toTimestamp(item.at),
        author: item.author,
        authorId: null,
        amountText: item.amountText,
        currency: item.currency,
        amount: numeric(item.amount),
        message: null,
        emojis: null,
      })),
      ...chat.paid.memberships.map(item => ({
        streamId,
        kind: 'membership',
        at: toTimestamp(item.at),
        author: item.author,
        authorId: null,
        amountText: null,
        currency: null,
        amount: null,
        message: item.header,
        emojis: null,
      })),
      ...(chat.paid.gifts ?? []).map(item => ({
        streamId,
        kind: 'gift',
        at: toTimestamp(item.at),
        author: item.author,
        authorId: null,
        amountText: null,
        currency: null,
        amount: numeric(item.count),
        message: item.text,
        emojis: null,
      })),
    ]
    for (const part of chunk(paid, 500)) {
      if (part.length) await tx.insert(paidEvents).values(part)
    }

    const commentRows = (pack.comments?.items ?? []).map(item => ({
      streamId,
      author: item.author,
      authorId: item.authorId,
      likes: item.likes,
      at: toTimestamp(item.at),
      pinned: item.pinned,
      byUploader: item.byUploader,
      text: item.text,
    }))
    for (const part of chunk(commentRows, 500)) {
      if (part.length) await tx.insert(comments).values(part)
    }

    const authorsList = collectAuthors(pack)
    const authorRows = authorsList.map(item => ({
      authorId: item.authorId,
      name: item.name,
      firstSeen: startedAt,
      lastSeen: startedAt,
    }))
    for (const part of chunk(authorRows, 500)) {
      if (!part.length) continue
      await tx.insert(authors).values(part).onConflictDoUpdate({
        target: authors.authorId,
        set: {
          name: sql`excluded.name`,
          firstSeen: sql`least(${authors.firstSeen}, excluded.first_seen)`,
          lastSeen: sql`greatest(${authors.lastSeen}, excluded.last_seen)`,
        },
      })
    }

    const streamAuthorRows = authorsList.map(item => ({
      streamId,
      authorId: item.authorId,
      messages: item.messages,
      superchats: item.superchats,
      stickers: item.stickers,
      memberships: item.memberships,
    }))
    for (const part of chunk(streamAuthorRows, 500)) {
      if (part.length) await tx.insert(streamAuthors).values(part)
    }

    const wordRows = collectWords(pack).map(item => ({
      streamId,
      word: item.word,
      count: item.count,
    }))
    for (const part of chunk(wordRows, 1000)) {
      if (part.length) await tx.insert(streamWords).values(part)
    }

    // 精确匹配的日程写入持久标记；读取时不必只依赖请求期的 videoId 集合。
    await tx
      .update(scheduledStreams)
      .set({ supersededBy: video.id, updatedAt: new Date() })
      .where(and(
        eq(scheduledStreams.datasetId, source.id),
        eq(scheduledStreams.videoId, video.id),
        isNull(scheduledStreams.supersededBy),
      ))
  })
}

await main()
