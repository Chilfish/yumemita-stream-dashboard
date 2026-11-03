import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { eq, sql } from 'drizzle-orm'
import { basename, resolve } from 'node:path'
import process from 'node:process'
import { aggregateDataset, type StreamRow } from '../src/lib/aggregate.ts'
import { isStopword } from '../src/lib/stopwords.ts'
import { createWriteDb } from '../src/db/connection.ts'
import {
  authors,
  comments,
  datasetInsights,
  datasets,
  ingestReports,
  paidEvents,
  streamAuthors,
  streamDetails,
  streams,
  streamWords,
} from '../src/db/schema.ts'
import type { StreamDatapack } from '../src/types/datapack.ts'
import { buildStreamSummary } from './lib/dataset-manifest.ts'
import { loadEnvFiles, requireEnv } from './lib/env.ts'

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
  batchSize: number
}

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
  const args: Args = { all: false, dryRun: false, force: false, batchSize: 50 }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dataset') args.dataset = argv[++index]
    else if (arg === '--ids') args.idsFile = argv[++index]
    else if (arg === '--limit') args.limit = Number(argv[++index])
    else if (arg === '--batch-size') args.batchSize = Math.max(1, Number(argv[++index]) || 50)
    else if (arg === '--all') { args.all = true; args.force = true }
    else if (arg === '--force') args.force = true
    else if (arg === '--dry-run') args.dryRun = true
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

  if (!args.dryRun) {
    const connection = createWriteDb(requireEnv('DATABASE_URL'))
    db = connection.db
    pool = connection.pool
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

        const hash = contentHash(raw)
        const previous = existing.get(videoId)
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
          report.failed += 1
          report.errors.push({ videoId, message: (error as Error).message })
        }

        if ((report.processed + report.skipped) % args.batchSize === 0) {
          console.log(`[ingest] ${source.id}: ${report.processed + report.skipped}/${packs.length}`)
        }
      }

      if (args.limit) {
        console.log(`[ingest] ${source.id}: 小批量模式，跳过 dataset_insights 重算`)
      }
      else if (changed || args.all) {
        const all = readPacks(source.id).map(({ file, raw }) => ({
          pack: JSON.parse(raw) as StreamDatapack,
          rel: `data/${source.id}/${basename(file)}`,
        }))
        const totals = buildInsights(all)
        await db.insert(datasetInsights).values({
          datasetId: source.id,
          totals,
          aggregation: totals.aggregation ?? null,
          generatedAt: new Date(),
        }).onConflictDoUpdate({
          target: datasetInsights.datasetId,
          set: { totals, aggregation: totals.aggregation ?? null, generatedAt: new Date() },
        })
        console.log(`[ingest] ${source.id}: insights 已更新（${all.length} 场）`)
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
  })
}

await main()
