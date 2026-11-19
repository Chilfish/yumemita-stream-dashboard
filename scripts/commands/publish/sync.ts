/**
 * 把本地已经抓好的数据同步到线上（Neon + R2）。
 *
 *   bun run ymmt publish sync                        # 默认只新增缺失场次
 *   bun run ymmt publish sync --dataset nonoka       # 只同步一个成员
 *   bun run ymmt publish sync --dry-run              # 只打印目标、新增数量与步骤
 *   bun run ymmt publish sync --update-existing      # 允许按内容 hash 改写已有场次
 *   bun run ymmt publish sync --force                # 连同已有场次一起全量重写
 *
 * 只认 `.dev.vars` 里的线上目标（`DATABASE_URL_ONLINE` / `R2_*`），并把进程切成 `LOCAL=0`，
 * 避免本地开关把数据写回本机 Postgres / SILO。
 *
 * 默认策略是**只新增**：先对比本地 pack 文件名与线上 `streams.video_id`，只把缺失的
 * videoId 交给 ingest / verify / publish。已有场次不读不写，避免一次本地重抓就把整库
 * 回写一遍。需要刷新旧场次时显式加 `--update-existing`。
 *
 * 顺序：数据库迁移 → 逐字稿 → ingest → 刷新公开汇总 → db verify → publish data → purge。
 * `publish data` 不带 `--assets-only`，会同时刷新 manifest / insights / 组级索引。
 *
 * 各步骤一律走同模块的 `run*` 函数（进程内调用，不再起子进程）；只有 `db ingest`
 * 还没有进程内入口，统一走 `spawnCommand()` → `bun scripts/cli.ts db ingest ...`。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Option } from 'commander'
import { inArray, sql } from 'drizzle-orm'
import { createDb } from '@/db/connection.ts'
import { streams, transcripts } from '@/db/schema.ts'
import { type CommandSpec, CliError, type Logger } from '@chilfish/devkit/cli'
import { applyOnlineEnv, readOnlineTarget } from '@chilfish/devkit/env'
import { devkit } from '../../dev.config.ts'
import { createObjectStore, readCredentials } from '@scripts/lib/object-storage.ts'
import { runMigrate } from '../db/migrate.ts'
import { runRefreshTotals } from '../db/totals.ts'
import { runVerify } from '../db/verify.ts'
import { runPublishData } from './data.ts'
import { runPurge } from './purge.ts'
import { runPublishTranscripts } from './transcripts.ts'

interface DatasetSource {
  id: string
  label: string
  datapackDir?: string
}

interface DatasetPlan {
  source: DatasetSource
  localCount: number
  remoteCount: number
  /** 最近窗口内需要检查的本地 videoId。 */
  candidates: string[]
  /** 线上还没有的 videoId；默认只同步这些。 */
  fresh: string[]
  localTranscripts: number
  remoteTranscripts: number
  /** 本次传给子步骤的 --ids 文件。 */
  idsFile?: string
}

const APP_ROOT = resolve(import.meta.dir, '../../..')
const CLI_PATH = join(APP_ROOT, 'scripts', 'cli.ts')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')
const IDS_DIR = join(APP_ROOT, 'temp', 'sync-ids')
const PACK_SUFFIX = '.datapack.json'

/** 默认日志器：不注入 `log` 时整条命令静默，只返回结果。 */
const silentLog: Logger = {
  name: 'publish.sync',
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  line: () => {},
  output: () => {},
  child: () => silentLog,
}

/** `runSync` 的入参：CLI 里每个 flag 的 camelCase 镜像。 */
export interface SyncOptions {
  /** `--dataset`：只同步指定 dataset（可重复）。 */
  dataset?: string[]
  /** `--update-existing`：允许改写已有场次（按内容 hash）。 */
  updateExisting?: boolean
  /** `--recent-days`：只检查最近 n 天改过的 pack，默认 7；0 表示检查全部。 */
  recentDays?: number
  /** `--skip-migrate`：跳过数据库迁移。 */
  skipMigrate?: boolean
  /** `--skip-transcripts`：跳过逐字稿发布。 */
  skipTranscripts?: boolean
  /** `--skip-ingest`：跳过数据库写入。 */
  skipIngest?: boolean
  /** `--skip-refresh`：跳过 dataset_insights.public_totals 刷新。 */
  skipRefresh?: boolean
  /** `--skip-verify`：跳过 db verify 对账。 */
  skipVerify?: boolean
  /** `--strict-verify`：verify 有差异时立即中止（默认只警告，继续发布）。 */
  strictVerify?: boolean
  /** `--skip-publish`：跳过对象存储发布。 */
  skipPublish?: boolean
  /** `--skip-purge`：跳过缓存失效。 */
  skipPurge?: boolean
  /** `--skip-compare`：跳过同步前的数据量对比（仍会查询新增 ID）。 */
  skipCompare?: boolean
  /** `--force`：等同上 --update-existing，并忽略增量判断全量重写。 */
  force?: boolean
  /** `--dry-run`：只打印目标、新增数量与步骤，不执行。 */
  dryRun?: boolean
  /** 进度日志；默认静默。 */
  log?: Logger
}

export interface SyncResult {
  exitCode: number
  data?: unknown
}

/** 用统一指令入口跑一个还没有 `run*` 的命令：`bun scripts/cli.ts <id> ...`。 */
async function spawnCommand(id: string, argv: string[], log: Logger): Promise<number> {
  log.info(`=== 子进程 ${id} ${argv.join(' ')} ===`)
  return await new Promise<number>((resolveCode, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...id.split('.'), ...argv], {
      cwd: APP_ROOT,
      env: process.env,
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('close', value => resolveCode(value ?? 1))
  })
}

function toList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) return value.map(item => String(item))
  return [String(value)]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function runSync(options: SyncOptions = {}): Promise<SyncResult> {
  const log = options.log ?? silentLog
  const dryRun = options.dryRun === true
  const force = options.force === true

  const { remote, databaseUrl, bucket } = readOnlineTarget({ config: devkit, cwd: APP_ROOT })

  const sources = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { datasets?: DatasetSource[] }
  const all = sources.datasets ?? []
  if (all.length === 0) {
    throw new CliError('data-sources.json 里没有 datasets', {
      hint: '在 data-sources.json 的 datasets 数组里补成员',
    })
  }

  const wanted = toList(options.dataset) ?? []
  const unknown = wanted.filter(id => !all.some(source => source.id === id))
  if (unknown.length > 0) {
    throw new CliError(`data-sources.json 里没有 dataset：${unknown.join(', ')}`, {
      hint: `可用：${all.map(source => source.id).join(', ')}`,
    })
  }

  const selected = wanted.length > 0 ? all.filter(source => wanted.includes(source.id)) : all
  const updateExisting = (options.updateExisting ?? false) || force
  const hasTranscripts = !options.skipTranscripts
  const hasPurge = !options.skipPurge
  const dbHost = new URL(databaseUrl).host

  const recentDays = options.recentDays ?? 7
  if (!Number.isFinite(recentDays) || recentDays < 0) {
    throw new CliError('--recent-days 需要是 >= 0 的数字', {
      hint: '默认 7；0 表示检查全部 pack',
    })
  }

  /**
   * 本地 pack 列表。`recentDays > 0` 时只把最近开播的场次当作候选
   * （按 `video.startedAt`；缺失时退回文件 mtime），历史场次视为已经同步过。
   */
  function localPackIds(source: DatasetSource): { all: string[], candidates: string[] } {
    const dir = resolve(APP_ROOT, source.datapackDir ?? `data/${source.id}`)
    let names: string[] = []
    try {
      names = readdirSync(dir).filter(name => name.endsWith(PACK_SUFFIX))
    }
    catch {
      return { all: [], candidates: [] }
    }
    const local = names.map(name => name.slice(0, -PACK_SUFFIX.length))
    if (recentDays <= 0)
      return { all: local, candidates: local }

    const cutoff = Date.now() - recentDays * 24 * 60 * 60 * 1000
    const candidates: string[] = []
    for (const name of names) {
      const videoId = name.slice(0, -PACK_SUFFIX.length)
      let startedAt = Number.NaN
      try {
        const pack = JSON.parse(readFileSync(join(dir, name), 'utf8')) as { video?: { startedAt?: string } }
        if (pack.video?.startedAt)
          startedAt = Date.parse(pack.video.startedAt)
      }
      catch {
        // 坏 pack 留给 ingest 报错；这里只决定要不要检查。
      }
      if (Number.isFinite(startedAt)) {
        if (startedAt >= cutoff)
          candidates.push(videoId)
        continue
      }
      try {
        if (statSync(join(dir, name)).mtimeMs >= cutoff)
          candidates.push(videoId)
      }
      catch {
        // 忽略无法 stat 的文件。
      }
    }
    return { all: local, candidates }
  }

  function localTranscriptCount(source: DatasetSource): number {
    try {
      return readdirSync(resolve(APP_ROOT, 'content', 'transcripts', source.id))
        .filter(name => name.endsWith('.md') && !name.startsWith('_') && !name.startsWith('.'))
        .length
    }
    catch {
      return 0
    }
  }

  const db = createDb(databaseUrl)
  const local = new Map(selected.map(source => [source.id, localPackIds(source)]))
  const candidateIds = [...new Set(selected.flatMap(source => local.get(source.id)?.candidates ?? []))]

  let remoteRows: { datasetId: string, videoId: string }[] = []
  if (candidateIds.length > 0) {
    remoteRows = await db
      .select({ datasetId: streams.datasetId, videoId: streams.videoId })
      .from(streams)
      .where(recentDays > 0 ? inArray(streams.videoId, candidateIds) : undefined)
      .catch((error: unknown) => {
        throw new CliError(`读取线上 streams 失败：${errorMessage(error)}`, {
          hint: '检查 .dev.vars 的 DATABASE_URL_ONLINE 是否可连',
        })
      })
  }
  const remoteIds = new Map<string, Set<string>>()
  for (const row of remoteRows) {
    const set = remoteIds.get(row.datasetId) ?? new Set<string>()
    set.add(row.videoId)
    remoteIds.set(row.datasetId, set)
  }

  const remoteCounts = await db
    .select({ id: streams.datasetId, count: sql<number>`count(*)::int` })
    .from(streams)
    .groupBy(streams.datasetId)
    .catch((error: unknown) => {
      throw new CliError(`读取线上 streams 数量失败：${errorMessage(error)}`, {
        hint: '检查 .dev.vars 的 DATABASE_URL_ONLINE 是否可连',
      })
    })
  const countByDataset = new Map(remoteCounts.map(row => [row.id, Number(row.count)]))

  const transcriptCounts = await db
    .select({ id: transcripts.datasetId, count: sql<number>`count(*)::int` })
    .from(transcripts)
    .groupBy(transcripts.datasetId)
    .catch((error: unknown) => {
      throw new CliError(`读取线上逐字稿数量失败：${errorMessage(error)}`, {
        hint: '检查 .dev.vars 的 DATABASE_URL_ONLINE 是否可连',
      })
    })
  const transcriptByDataset = new Map(transcriptCounts.map(row => [row.id, Number(row.count)]))

  const plan: DatasetPlan[] = selected.map((source) => {
    const localState = local.get(source.id) ?? { all: [], candidates: [] }
    const remoteSet = remoteIds.get(source.id) ?? new Set<string>()
    return {
      source,
      localCount: localState.all.length,
      remoteCount: countByDataset.get(source.id) ?? 0,
      candidates: localState.candidates,
      fresh: localState.candidates.filter(videoId => !remoteSet.has(videoId)),
      localTranscripts: localTranscriptCount(source),
      remoteTranscripts: transcriptByDataset.get(source.id) ?? 0,
    }
  })

  const plannedNew = plan.reduce((sum, item) => sum + item.fresh.length, 0)
  const plannedCandidates = plan.reduce((sum, item) => sum + item.candidates.length, 0)
  const transcriptDiff = plan.filter(item => item.localTranscripts !== item.remoteTranscripts)

  log.info('线上目标')
  log.info(`  数据库：${dbHost}`)
  log.info(`  对象存储：r2://${bucket}`)
  log.info(`  成员：${plan.map(item => item.source.id).join(', ')}`)
  log.info(`  策略：${updateExisting ? '更新已有 + 新增（按 hash）' : '只新增缺失场次'}`)
  log.info(`  窗口：${recentDays > 0 ? `最近 ${recentDays} 天开播的 pack` : '全部 pack'}（候选 ${plannedCandidates}）`)
  log.info(`  新增场次：${plannedNew}`)
  const steps = [
    options.skipMigrate ? null : 'migrate',
    hasTranscripts ? 'transcripts' : null,
    options.skipIngest ? null : 'ingest',
    options.skipRefresh ? null : 'refresh',
    options.skipVerify ? null : 'verify',
    options.skipPublish ? null : 'publish',
    hasPurge ? 'purge' : null,
  ].filter(Boolean).join(' → ') || '（无）'
  log.info(`  步骤：${steps}`)

  function countFiles(dir: string, predicate: (name: string) => boolean): number {
    try {
      return readdirSync(dir).filter(predicate).length
    }
    catch {
      return 0
    }
  }

  function countObjects(objects: ReadonlyMap<string, number>, prefix: string, suffix = ''): number {
    let count = 0
    for (const key of objects.keys()) {
      if (key.startsWith(prefix) && key.endsWith(suffix))
        count += 1
    }
    return count
  }

  /** 本地 / 远端数量对比；只读，并且只在没加 --skip-compare 时列桶。 */
  async function compareVolumes(): Promise<void> {
    const credentials = readCredentials({ ...remote, LOCAL: '0' })
    if (!credentials) {
      throw new CliError('无法构造线上对象存储凭据', {
        hint: '检查 .dev.vars 里的 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET',
      })
    }

    let objects: Map<string, number>
    try {
      objects = await createObjectStore(credentials).list()
    }
    catch (error) {
      throw new CliError(`列远端对象失败：${errorMessage(error)}`, {
        hint: '检查 R2 凭据与桶名；或加 --skip-compare 跳过对比',
      })
    }

    log.info('数据量对比（本地 / 远端）')
    for (const item of plan) {
      const { source } = item
      const dir = resolve(APP_ROOT, source.datapackDir ?? `data/${source.id}`)
      const thumbs = countFiles(resolve(dir, 'thumbs'), name => name.endsWith('.jpg') || name.endsWith('.webp'))
      const emoji = countFiles(resolve(dir, 'emoji'), name => name.endsWith('.png'))
      const archive = countObjects(objects, `archive/${source.id}/`, PACK_SUFFIX)
      const remoteThumbs = countObjects(objects, `${source.id}/thumbs/`)
      const remoteEmoji = countObjects(objects, `emojis/${source.id}/`, '.png')
      const remoteTranscripts = countObjects(objects, `${source.id}/transcripts/`, '.json')

      log.info(
        `  ${source.id}: packs ${item.localCount}/${item.remoteCount}（新增 ${item.fresh.length}，候选 ${item.candidates.length}，archive ${archive}）`
        + `  thumbs ${thumbs}/${remoteThumbs}  emoji ${emoji}/${remoteEmoji}`
        + `  transcripts ${item.localTranscripts}/${remoteTranscripts}（库 ${item.remoteTranscripts}）`,
      )
    }
    if (updateExisting)
      log.info('--update-existing：已有场次会按内容 hash 判断是否重写')
    else
      log.info('默认只新增：已有场次不读不写；要刷新旧数据加 --update-existing')
  }

  if (!options.skipCompare)
    await compareVolumes()

  const affected = updateExisting
    ? plan.filter(item => item.candidates.length > 0)
    : plan.filter(item => item.fresh.length > 0)

  if (affected.length > 0 && !dryRun) {
    mkdirSync(IDS_DIR, { recursive: true })
    for (const item of affected) {
      const ids = updateExisting ? item.candidates : item.fresh
      if (ids.length === 0)
        continue
      const path = join(IDS_DIR, `${item.source.id}.txt`)
      writeFileSync(path, `${ids.join('\n')}\n`, 'utf8')
      item.idsFile = path
    }
  }

  const selectors = affected.flatMap(item => ['--dataset', item.source.id])

  if (dryRun) {
    log.info(
      `dry-run：未执行任何写入；新场次 ${plannedNew} 场（候选 ${plannedCandidates}）`
      + `，逐字稿数量有差异的成员 ${transcriptDiff.length} 个`,
    )
    return {
      exitCode: 0,
      data: {
        dryRun: true,
        databaseHost: dbHost,
        bucket,
        updateExisting,
        recentDays,
        plannedNew,
        plannedCandidates,
        steps,
        datasets: plan.map(item => ({
          id: item.source.id,
          localCount: item.localCount,
          remoteCount: item.remoteCount,
          candidates: item.candidates.length,
          fresh: item.fresh.length,
          localTranscripts: item.localTranscripts,
          remoteTranscripts: item.remoteTranscripts,
        })),
        transcriptDiff: transcriptDiff.map(item => item.source.id),
      },
    }
  }

  /** 单步失败即中止：提示里带上可直接照抄的重跑命令。 */
  function assertStep(label: string, code: number, rerunHint: string): void {
    if (code === 0) return
    throw new CliError(`${label} 失败（exit ${code}）`, {
      hint: `单独重跑看细节：${rerunHint} --log-level debug`,
    })
  }

  const restoreEnv = applyOnlineEnv({ config: devkit, remote })
  try {
    if (!options.skipMigrate) {
      log.info('=== 数据库迁移 ===')
      const result = await runMigrate({ dryRun, log: log.child('db-migrate') })
      assertStep('数据库迁移', result.exitCode, 'bun run ymmt db migrate')
    }

    if (hasTranscripts) {
      log.info('=== 逐字稿 ===')
      const result = await runPublishTranscripts({ dryRun, log: log.child('publish-transcripts') })
      assertStep('逐字稿', result.exitCode, 'bun run ymmt publish transcripts')
    }

    if (affected.length === 0) {
      log.info('没有新增场次；默认不改写已有数据，跳过 ingest / refresh / verify / publish / purge')
      return {
        exitCode: 0,
        data: { databaseHost: dbHost, bucket, plannedNew, plannedCandidates, affected: [], steps },
      }
    }

    if (!options.skipIngest) {
      for (const item of affected) {
        const argv = ['--dataset', item.source.id, ...(item.idsFile ? ['--ids', item.idsFile] : [])]
        if (!updateExisting)
          argv.push('--new-only')
        if (force)
          argv.push('--force')
        // db/ingest.ts 只导出 dbIngestSpec、main(argv) 是私有的：没有进程内入口，走统一 CLI。
        assertStep(
          `ingest ${item.source.id}`,
          await spawnCommand('db.ingest', argv, log),
          `bun run ymmt db ingest --dataset ${item.source.id}`,
        )
      }
    }

    if (!options.skipRefresh) {
      log.info('=== 刷新公开汇总 ===')
      const result = await runRefreshTotals({
        dataset: affected.map(item => item.source.id),
        dryRun,
        log: log.child('refresh-public-totals'),
      })
      assertStep('刷新公开汇总', result.exitCode, `bun run ymmt db totals ${selectors.join(' ')}`)
    }

    let verifyFailures = 0
    if (!options.skipVerify) {
      for (const item of affected) {
        log.info(`=== verify ${item.source.id} ===`)
        const result = await runVerify({
          dataset: item.source.id,
          idsFile: item.idsFile,
          log: log.child('db-verify'),
        })
        if (result.exitCode === 0) continue
        verifyFailures += 1
        if (options.strictVerify) {
          throw new CliError(`verify ${item.source.id} 失败（exit ${result.exitCode}）`, {
            hint: `单独重跑看差异：bun run ymmt db verify --dataset ${item.source.id}`,
          })
        }
        log.warn(`verify ${item.source.id} 有差异（exit ${result.exitCode}），继续发布；严格模式加 --strict-verify`)
      }
    }

    if (!options.skipPublish) {
      for (const item of affected) {
        log.info(`=== publish ${item.source.id} ===`)
        const result = await runPublishData({
          dataset: item.source.id,
          adoptRemote: true,
          ids: item.idsFile,
          force,
          dryRun,
          log: log.child('publish-data'),
        })
        assertStep(`publish ${item.source.id}`, result.exitCode, `bun run ymmt publish data --dataset ${item.source.id} --adopt-remote`)
      }
    }

    if (hasPurge) {
      log.info('=== 缓存失效 ===')
      const result = await runPurge({
        dataset: affected.map(item => item.source.id),
        tags: hasTranscripts ? ['transcripts'] : undefined,
        dryRun,
        log: log.child('purge-cache'),
      })
      assertStep('缓存失效', result.exitCode, `bun run ymmt publish purge ${selectors.join(' ')}`)
    }

    if (verifyFailures > 0) {
      log.warn(`完成，但 ${verifyFailures} 个成员的 verify 有差异；修完可重跑 verify`)
    }
    else {
      log.info('完成')
    }

    return {
      exitCode: verifyFailures > 0 ? 1 : 0,
      data: {
        databaseHost: dbHost,
        bucket,
        updateExisting,
        recentDays,
        plannedNew,
        plannedCandidates,
        steps,
        affected: affected.map(item => ({
          id: item.source.id,
          ids: updateExisting ? item.candidates.length : item.fresh.length,
          idsFile: item.idsFile ?? null,
        })),
        verifyFailures,
      },
    }
  }
  finally {
    restoreEnv()
  }
}

export const publishSyncSpec: CommandSpec = {
  id: 'publish.sync',
  description: '同步到线上：把本地 pack / 封面 / 逐字稿推到 .dev.vars 指定的 Neon + R2',
  details: '只读 .dev.vars 的线上目标（DATABASE_URL_ONLINE / R2_*），执行期间强制 LOCAL=0。\n'
    + '默认只新增缺失场次；需要刷新旧场次加 --update-existing（或 --force）。\n'
    + '顺序：迁移 → 逐字稿 → ingest → 刷新公开汇总 → verify → publish data → purge。',
  examples: [
    'bun run ymmt publish sync',
    'bun run ymmt publish sync --dataset nonoka',
    'bun run ymmt publish sync --dry-run',
    'bun run ymmt publish sync --update-existing',
    'bun run ymmt publish sync --skip-publish --skip-purge',
  ],
  options: [
    new Option('--dataset <id>', '只同步指定 dataset，可重复').argParser((value: string, previous: string[] = []) => [...previous, value]),
    new Option('--update-existing', '允许改写已有场次（按内容 hash；默认完全不动旧场次）'),
    new Option('--recent-days <n>', '只检查最近 n 天改过的 pack，默认 7；0 表示检查全部').default('7'),
    new Option('--skip-migrate', '跳过数据库迁移（默认先应用 drizzle/ 迁移）'),
    new Option('--skip-transcripts', '跳过逐字稿发布'),
    new Option('--skip-ingest', '跳过数据库写入'),
    new Option('--skip-refresh', '跳过 dataset_insights.public_totals 刷新'),
    new Option('--skip-verify', '跳过 db verify 对账'),
    new Option('--strict-verify', 'verify 有差异时立即中止（默认只警告，继续发布）'),
    new Option('--skip-publish', '跳过对象存储发布'),
    new Option('--skip-purge', '跳过缓存失效'),
    new Option('--skip-compare', '跳过同步前的数据量比对（仍会查询新增 ID）'),
    new Option('--force', '等同上 --update-existing，并忽略增量判断全量重写'),
  ],
  async run(ctx) {
    const result = await runSync({
      dataset: toList(ctx.options.dataset),
      updateExisting: ctx.flag('updateExisting'),
      recentDays: ctx.integer('recentDays', 7, 0),
      skipMigrate: ctx.flag('skipMigrate'),
      skipTranscripts: ctx.flag('skipTranscripts'),
      skipIngest: ctx.flag('skipIngest'),
      skipRefresh: ctx.flag('skipRefresh'),
      skipVerify: ctx.flag('skipVerify'),
      strictVerify: ctx.flag('strictVerify'),
      skipPublish: ctx.flag('skipPublish'),
      skipPurge: ctx.flag('skipPurge'),
      skipCompare: ctx.flag('skipCompare'),
      force: ctx.flag('force'),
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    const data = result.data as { verifyFailures?: number, plannedNew?: number, dryRun?: boolean } | undefined
    return {
      exitCode: result.exitCode,
      data: result.data,
      summary: data?.dryRun
        ? `dry-run：未执行任何写入（新场次 ${data.plannedNew ?? 0} 场）`
        : (data?.verifyFailures ?? 0) > 0
          ? `同步完成，但 ${data?.verifyFailures} 个成员的 verify 有差异`
          : '同步完成',
    }
  },
}
