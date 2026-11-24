/**
 * 把线上库增量同步到本机库（开发副本）。
 *
 *   bun run ymmt db pull                       # 按 content_hash 增量：补缺失 + 内容不同的场次
 *   bun run ymmt db pull --dataset nonoka      # 只同步一个成员
 *   bun run ymmt db pull --full                # 忽略 hash，重写选中成员的全部场次
 *   bun run ymmt db pull --keep-local          # 保留本机独有场次（默认删除）
 *   bun run ymmt db pull --dry-run             # 只打印计划，不写库
 *
 * 线上目标只从 `.dev.vars.prod` 的 `DATABASE_URL` 读（`readOnlineTarget`）；
 * 写入目标必须是本机库，`DATABASE_URL` 不是本机地址时直接拒绝，避免把线上行写回线上。
 *
 * 数据方向与 `publish sync` 相反：那边把本地 pack 推到线上，这里把线上行拉到本地，
 * 本机按线上对齐：场次与全部子表按 `(dataset_id, video_id)` 覆盖，本机独有场次默认删除，
 * `scheduled_streams` 整体覆盖（本地改过的日程被线上版本替换，不合并）。
 * `--full` 在 ingest 逻辑变更后用来刷新子表，因为 hash 相同不代表旧代码灌的明细一致。
 * `streams.id` 与子表 `stream_id` 在本机重新分配，不沿用线上自增 id。
 */
import { resolve } from 'node:path'
import { Option } from 'commander'
import { eq, inArray, sql } from 'drizzle-orm'
import { type CommandSpec, CliError, type Logger, requireEnvVar, UsageError } from '@chilfish/devkit/cli'
import { createDb, createWriteDb, isLocalDatabaseUrl } from '@/db/connection.ts'
import {
  authors,
  comments,
  datasetInsights,
  datasets,
  paidEvents,
  scheduledStreams,
  streamAuthors,
  streamDetails,
  streams,
  streamWords,
  transcripts,
} from '@/db/schema.ts'
import { planStreamPull, type StreamPullEntry } from '@scripts/lib/stream-sync.ts'
import { readOnlineTarget } from '@scripts/lib/online-env.ts'
import { devkit } from '../../dev.config.ts'

/** 只取命令需要的日志通道；默认空操作，被其它脚本调用时不产生输出。 */
export type PullLog = Pick<Logger, 'info' | 'warn' | 'error' | 'line'>

const NOOP_LOG: PullLog = { info: () => {}, warn: () => {}, error: () => {}, line: () => {} }

const APP_ROOT = resolve(import.meta.dir, '../../..')
/** 一次从线上读多少个场次的明细；Neon HTTP 的参数列表别太长。 */
const STREAM_CHUNK = 50
/** 子表批量读写的行数上限。 */
const WRITE_CHUNK = 500
const DATABASE_HINT = '在 .dev.vars 配置 DATABASE_URL；本地可先运行 bun run ymmt dev db'

export interface PullOptions {
  /** `--dataset`：只同步指定 dataset（可重复）。 */
  dataset?: string[]
  /** `--full`：忽略 content_hash，重写选中成员的全部场次。 */
  full?: boolean
  /** `--keep-local`：保留本机独有场次；默认删除，让本机与线上一致。 */
  keepLocal?: boolean
  /** 全局 `--dry-run`：只打印计划，不写库。 */
  dryRun?: boolean
  log?: PullLog
}

export interface PullResult {
  exitCode: number
  data: {
    mode: 'dry-run' | 'apply'
    databaseHost: string
    datasets: string[]
    streams: {
      missing: number
      changed: number
      forced: number
      skipped: number
      removed: number
      failed: number
    }
    transcripts: number
    schedules: number
    insights: number
    failures: { scope: string, message: string }[]
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

function toList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) return value.map(item => String(item))
  return [String(value)]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 去掉自增主键，避免和本机已有 id 冲突。 */
function withoutId<T extends { id: number }>(row: T): Omit<T, 'id'> {
  const { id: _omit, ...rest } = row
  return rest
}

function countOf(entries: StreamPullEntry[], reason: StreamPullEntry['reason']): number {
  return entries.filter(entry => entry.reason === reason).length
}

/** 按线上 stream id 分组，写入本机时替换成新的 stream_id。 */
function groupByStream<T extends { streamId: number }>(rows: T[]): Map<number, T[]> {
  const map = new Map<number, T[]>()
  for (const row of rows) {
    const list = map.get(row.streamId) ?? []
    list.push(row)
    map.set(row.streamId, list)
  }
  return map
}

type ReadDb = ReturnType<typeof createDb>
type LocalDb = ReturnType<typeof createWriteDb>['db']

/** 线上库 → 本机库的增量同步。 */
export async function runPull(options: PullOptions = {}): Promise<PullResult> {
  const log = options.log ?? NOOP_LOG
  const dryRun = options.dryRun === true
  const full = options.full === true
  const keepLocal = options.keepLocal === true

  const localUrl = requireEnvVar('DATABASE_URL', DATABASE_HINT)
  if (!isLocalDatabaseUrl(localUrl)) {
    throw new CliError('db pull 只写本机库，但 DATABASE_URL 不是本机地址', {
      code: 'NON_LOCAL_TARGET',
      hint: '把 .dev.vars 的 DATABASE_URL 指回 localhost，或加 LOCAL=1；线上目标写在 .dev.vars.prod',
      context: { host: new URL(localUrl).host },
    })
  }

  const { databaseUrl: remoteUrl } = readOnlineTarget({ config: devkit, cwd: APP_ROOT })
  const remote = createDb(remoteUrl)
  const { db: local, pool } = createWriteDb(localUrl)
  const failures: { scope: string, message: string }[] = []

  try {
    const remoteDatasets = await remote.select().from(datasets).orderBy(datasets.id)
    if (remoteDatasets.length === 0) {
      throw new CliError('线上 datasets 为空', { hint: '确认 .dev.vars.prod 的 DATABASE_URL 指向正确的库' })
    }

    const wanted = toList(options.dataset) ?? []
    const known = new Set(remoteDatasets.map(row => row.id))
    const unknown = wanted.filter(id => !known.has(id))
    if (unknown.length > 0) {
      throw new UsageError(`线上没有 dataset：${unknown.join(', ')}`, {
        code: 'UNKNOWN_DATASET',
        hint: `可用：${[...known].join(', ')}`,
        context: { dataset: unknown },
      })
    }

    const selected = wanted.length > 0
      ? remoteDatasets.filter(row => wanted.includes(row.id))
      : remoteDatasets
    const selectedIds = selected.map(row => row.id)
    const localHost = new URL(localUrl).host

    log.info(`本机目标：${localHost}${new URL(localUrl).pathname}`)
    log.info(`线上来源：${new URL(remoteUrl).host}${new URL(remoteUrl).pathname}`)
    log.info(`成员：${selectedIds.join(', ')}`)
    log.info(
      `策略：${full ? '全量重写选中成员' : '按 content_hash 增量'}`
      + `；本机独有场次${keepLocal ? '保留' : '删除'}；日程表整体覆盖`,
    )

    const counts = { missing: 0, changed: 0, forced: 0, skipped: 0, removed: 0, failed: 0 }
    const localOnlyIds: { datasetId: string, videoId: string }[] = []

    // datasets 先落行，后续外键才有归属。
    if (!dryRun) {
      for (const row of selected) {
        await local.insert(datasets).values(row).onConflictDoUpdate({
          target: datasets.id,
          set: {
            label: row.label,
            kind: row.kind,
            color: row.color,
            avatarKey: row.avatarKey,
            channelId: row.channelId,
            subject: row.subject,
            scope: row.scope,
            note: row.note,
            updatedAt: new Date(),
          },
        })
      }
    }

    for (const source of selected) {
      const remoteRows = await remote
        .select()
        .from(streams)
        .where(eq(streams.datasetId, source.id))
        .orderBy(streams.id)
      const localRows = await local
        .select({ videoId: streams.videoId, contentHash: streams.contentHash })
        .from(streams)
        .where(eq(streams.datasetId, source.id))

      const plan = planStreamPull(
        localRows.map(row => ({ videoId: row.videoId, contentHash: row.contentHash })),
        remoteRows.map(row => ({ videoId: row.videoId, contentHash: row.contentHash })),
        { force: full },
      )
      const planned = new Set(plan.entries.map(entry => entry.videoId))
      counts.missing += countOf(plan.entries, 'missing')
      counts.changed += countOf(plan.entries, 'changed')
      counts.forced += countOf(plan.entries, 'forced')
      counts.skipped += remoteRows.length - planned.size
      for (const videoId of plan.localOnly)
        localOnlyIds.push({ datasetId: source.id, videoId })

      log.info(
        `[${source.id}] 线上 ${remoteRows.length} 场：新增 ${countOf(plan.entries, 'missing')}`
        + `，更新 ${countOf(plan.entries, 'changed') + countOf(plan.entries, 'forced')}`
        + `，一致 ${remoteRows.length - planned.size}`
        + (plan.localOnly.length > 0 ? `，本机独有 ${plan.localOnly.length}` : ''),
      )
      if (dryRun || plan.entries.length === 0) continue

      const byVideo = new Map(remoteRows.map(row => [row.videoId, row]))
      const targets = plan.entries
        .map(entry => byVideo.get(entry.videoId))
        .filter((row): row is NonNullable<typeof row> => row != null)

      for (const batch of chunk(targets, STREAM_CHUNK)) {
        const ids = batch.map(row => row.id)
        const [detailRows, paidRows, commentRows, authorRows, wordRows] = await Promise.all([
          remote.select().from(streamDetails).where(inArray(streamDetails.streamId, ids)),
          remote.select().from(paidEvents).where(inArray(paidEvents.streamId, ids)),
          remote.select().from(comments).where(inArray(comments.streamId, ids)),
          remote.select().from(streamAuthors).where(inArray(streamAuthors.streamId, ids)),
          remote.select().from(streamWords).where(inArray(streamWords.streamId, ids)),
        ])
        const detailByStream = new Map(detailRows.map(row => [row.streamId, row]))
        const paidByStream = groupByStream(paidRows)
        const commentsByStream = groupByStream(commentRows)
        const authorsByStream = groupByStream(authorRows)
        const wordsByStream = groupByStream(wordRows)

        for (const row of batch) {
          try {
            await writeStream(local, row, {
              detail: detailByStream.get(row.id),
              paid: paidByStream.get(row.id) ?? [],
              comments: commentsByStream.get(row.id) ?? [],
              authors: authorsByStream.get(row.id) ?? [],
              words: wordsByStream.get(row.id) ?? [],
            })
          }
          catch (error) {
            counts.failed += 1
            failures.push({ scope: `${source.id}/${row.videoId}`, message: errorMessage(error) })
            log.warn(`[${source.id}] ${row.videoId} 同步失败：${errorMessage(error)}`)
          }
        }
      }
    }

    // 本机独有场次：默认删除，让本机与线上一致（子表随外键级联）。
    if (!keepLocal && localOnlyIds.length > 0 && !dryRun) {
      for (const part of chunk(localOnlyIds, WRITE_CHUNK)) {
        const datasetId = part[0]?.datasetId
        if (datasetId == null) continue
        const ids = part.map(item => item.videoId)
        await local
          .delete(streams)
          .where(sql`${streams.datasetId} = ${datasetId} and ${streams.videoId} in ${ids}`)
        counts.removed += ids.length
      }
    }
    else if (!keepLocal) {
      counts.removed = localOnlyIds.length
    }

    const transcriptCount = dryRun
      ? await countRemote(remote, transcripts, selectedIds)
      : await pullTranscripts(remote, local, selectedIds)
    const insightCount = await pullInsights(remote, local, selectedIds, dryRun)
    const scheduleCount = dryRun
      ? await countRemote(remote, scheduledStreams, selectedIds)
      : await pullSchedules(remote, local, selectedIds)
    if (!dryRun) await pullMissingAuthors(remote, local, selectedIds, log)

    log.info(
      `完成：新增 ${counts.missing}、更新 ${counts.changed + counts.forced}、一致 ${counts.skipped}`
      + `、本机独有 ${counts.removed}、失败 ${counts.failed}；`
      + `逐字稿 ${transcriptCount}；insights ${insightCount}；日程 ${scheduleCount}（整体覆盖）`,
    )

    return {
      exitCode: counts.failed > 0 ? 1 : 0,
      data: {
        mode: dryRun ? 'dry-run' : 'apply',
        databaseHost: localHost,
        datasets: selectedIds,
        streams: counts,
        transcripts: transcriptCount,
        schedules: scheduleCount,
        insights: insightCount,
        failures,
      },
    }
  }
  finally {
    await pool.end()
  }
}

/** 一场一个事务：upsert streams，再整体替换子表，保证明细与线上一致。 */
async function writeStream(
  local: LocalDb,
  row: typeof streams.$inferSelect,
  children: {
    detail: typeof streamDetails.$inferSelect | undefined
    paid: (typeof paidEvents.$inferSelect)[]
    comments: (typeof comments.$inferSelect)[]
    authors: (typeof streamAuthors.$inferSelect)[]
    words: (typeof streamWords.$inferSelect)[]
  },
): Promise<void> {
  await local.transaction(async (tx) => {
    const values = withoutId(row)
    const [written] = await tx
      .insert(streams)
      .values(values)
      .onConflictDoUpdate({ target: [streams.datasetId, streams.videoId], set: values })
      .returning({ id: streams.id })
    if (!written) throw new Error('streams upsert 未返回 id')
    const streamId = written.id

    await tx.delete(streamDetails).where(eq(streamDetails.streamId, streamId))
    await tx.delete(paidEvents).where(eq(paidEvents.streamId, streamId))
    await tx.delete(comments).where(eq(comments.streamId, streamId))
    await tx.delete(streamAuthors).where(eq(streamAuthors.streamId, streamId))
    await tx.delete(streamWords).where(eq(streamWords.streamId, streamId))

    if (children.detail) {
      const { streamId: _remoteStreamId, ...rest } = children.detail
      await tx.insert(streamDetails).values({ ...rest, streamId })
    }

    for (const part of chunk(children.paid.map(item => ({ ...withoutId(item), streamId })), WRITE_CHUNK)) {
      if (part.length) await tx.insert(paidEvents).values(part)
    }
    for (const part of chunk(children.comments.map(item => ({ ...withoutId(item), streamId })), WRITE_CHUNK)) {
      if (part.length) await tx.insert(comments).values(part)
    }
    for (const part of chunk(children.authors.map(item => ({ ...item, streamId })), WRITE_CHUNK)) {
      if (part.length) await tx.insert(streamAuthors).values(part)
    }
    for (const part of chunk(children.words.map(item => ({ ...item, streamId })), WRITE_CHUNK)) {
      if (part.length) await tx.insert(streamWords).values(part)
    }
  })
}

/** 逐字稿按 (dataset_id, video_id) 增量覆盖；表很小，直接全量 upsert。 */
async function pullTranscripts(remote: ReadDb, local: LocalDb, datasetIds: string[]): Promise<number> {
  const rows = await remote.select().from(transcripts).where(inArray(transcripts.datasetId, datasetIds))
  for (const slice of chunk(rows, WRITE_CHUNK)) {
    if (slice.length === 0) continue
    await local.insert(transcripts).values(slice).onConflictDoUpdate({
      target: [transcripts.datasetId, transcripts.videoId],
      set: {
        r2Key: sql`excluded.r2_key`,
        title: sql`excluded.title`,
        date: sql`excluded.date`,
        summary: sql`excluded.summary`,
        tags: sql`excluded.tags`,
        updatedAt: sql`excluded.updated_at`,
        contentHash: sql`excluded.content_hash`,
      },
    })
  }
  return rows.length
}

/** `dataset_insights` 整行覆盖：本机缺行时也补上，页面汇总直接可用。 */
async function pullInsights(
  remote: ReadDb,
  local: LocalDb,
  datasetIds: string[],
  dryRun: boolean,
): Promise<number> {
  const rows = await remote
    .select()
    .from(datasetInsights)
    .where(inArray(datasetInsights.datasetId, datasetIds))
  if (dryRun) return rows.length
  for (const row of rows) {
    await local.insert(datasetInsights).values(row).onConflictDoUpdate({
      target: datasetInsights.datasetId,
      set: {
        totals: row.totals,
        publicTotals: row.publicTotals,
        aggregation: row.aggregation,
        generatedAt: row.generatedAt,
      },
    })
  }
  return rows.length
}

/** 日程表整体覆盖：先删选中成员的全部本机日程，再写入线上行。 */
async function pullSchedules(remote: ReadDb, local: LocalDb, datasetIds: string[]): Promise<number> {
  const rows = await remote
    .select()
    .from(scheduledStreams)
    .where(inArray(scheduledStreams.datasetId, datasetIds))
  await local.transaction(async (tx) => {
    await tx.delete(scheduledStreams).where(inArray(scheduledStreams.datasetId, datasetIds))
    for (const slice of chunk(rows, WRITE_CHUNK)) {
      if (slice.length === 0) continue
      await tx.insert(scheduledStreams).values(slice)
    }
  })
  return rows.length
}

/** dry-run 只统计远端行数，不写库。 */
async function countRemote(
  remote: ReadDb,
  table: typeof transcripts | typeof scheduledStreams,
  datasetIds: string[],
): Promise<number> {
  const [row] = await remote
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .where(inArray(table.datasetId, datasetIds))
  return Number(row?.count ?? 0)
}

/** 只补本机缺失的作者行，避免每次拉全表。 */
async function pullMissingAuthors(
  remote: ReadDb,
  local: LocalDb,
  datasetIds: string[],
  log: PullLog,
): Promise<void> {
  const remoteAuthorRows = await remote
    .selectDistinct({ authorId: streamAuthors.authorId })
    .from(streamAuthors)
    .innerJoin(streams, eq(streams.id, streamAuthors.streamId))
    .where(inArray(streams.datasetId, datasetIds))
  if (remoteAuthorRows.length === 0) return

  const localAuthorRows = await local.select({ authorId: authors.authorId }).from(authors)
  const localIds = new Set(localAuthorRows.map(row => row.authorId))
  const missing = remoteAuthorRows
    .map(row => row.authorId)
    .filter(authorId => !localIds.has(authorId))
  if (missing.length === 0) {
    log.info(`[authors] 已是最新（${localIds.size} 位）`)
    return
  }

  let written = 0
  for (const slice of chunk(missing, 5000)) {
    const rows = await remote.select().from(authors).where(inArray(authors.authorId, slice))
    for (const part of chunk(rows, WRITE_CHUNK)) {
      if (part.length === 0) continue
      await local.insert(authors).values(part).onConflictDoNothing({ target: authors.authorId })
      written += part.length
    }
  }
  log.info(`[authors] 补 ${written} 位（共 ${localIds.size + written} 位）`)
}

/** 把线上库增量同步到本机库；本机独有场次与日程表按线上对齐。 */
export const dbPullSpec: CommandSpec = {
  id: 'db.pull',
  description: '从线上库增量同步到本机库（日程表整体覆盖）',
  details: '线上来源只读 `.dev.vars.prod` 的 DATABASE_URL，写入目标必须是本机库。\n'
    + '按 content_hash 增量：补本机缺失 + 内容不同的场次，其余跳过整场明细的传输。\n'
    + '本机独有场次默认删除（--keep-local 保留）；scheduled_streams 每次整体覆盖，本地改动不保留。\n'
    + 'ingest 逻辑变更后加 --full 重写选中成员的全部场次——hash 相同不代表旧代码灌的明细一致。\n'
    + '本机自增 id 重新分配，不沿用线上 stream id。',
  examples: [
    'bun run ymmt db pull',
    'bun run ymmt db pull --dataset nonoka',
    'bun run ymmt db pull --full',
    'bun run ymmt db pull --dry-run',
  ],
  options: [
    new Option('--dataset <id>', '只同步指定 dataset，可重复').argParser(
      (value: string, previous: string[] = []) => [...previous, value],
    ),
    new Option('--full', '忽略 content_hash，重写选中成员的全部场次'),
    new Option('--keep-local', '保留本机独有场次（默认删除，与线上对齐）'),
  ],
  async run(ctx) {
    const result = await runPull({
      dataset: toList(ctx.options.dataset),
      full: ctx.flag('full'),
      keepLocal: ctx.flag('keepLocal'),
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    const { data } = result
    return {
      exitCode: result.exitCode,
      data,
      summary: `${data.mode === 'dry-run' ? 'dry-run 未写库' : '已写库'}：`
        + `场次新增 ${data.streams.missing}、更新 ${data.streams.changed + data.streams.forced}`
        + `、一致 ${data.streams.skipped}、删除 ${data.streams.removed}、失败 ${data.streams.failed}；`
        + `逐字稿 ${data.transcripts}；日程 ${data.schedules}`,
    }
  },
}
