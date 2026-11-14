#!/usr/bin/env bun
/**
 * 把本地已经抓好的数据同步到线上（Neon + R2）。
 *
 *   bun run sync:remote                        # 默认只新增缺失场次
 *   bun run sync:remote -- --dataset nonoka    # 只同步一个成员
 *   bun run sync:remote -- --dry-run           # 只打印目标、新增数量与步骤
 *   bun run sync:remote -- --update-existing   # 允许按内容 hash 改写已有场次
 *   bun run sync:remote -- --force             # 连同已有场次一起全量重写
 *
 * 只认 `.dev.vars` 里的线上目标（`DATABASE_URL_ONLINE` / `R2_*`），并在子进程里设置 `LOCAL=0`，
 * 避免本地开关把数据写回本机 Postgres / SILO。
 *
 * 默认策略是**只新增**：先对比本地 pack 文件名与线上 `streams.video_id`，只把缺失的
 * videoId 交给 ingest / verify / publish。已有场次不读不写，避免一次本地重抓就把整库
 * 回写一遍。需要刷新旧场次时显式加 `--update-existing`。
 *
 * 顺序：数据库迁移 → 逐字稿 → ingest → 刷新公开汇总 → db:verify → publish:data → purge。
 * `publish:data` 不带 `--assets-only`，会同时刷新 manifest / insights / 组级索引。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { inArray, sql } from 'drizzle-orm'
import { createDb } from '../src/db/connection.ts'
import { streams, transcripts } from '../src/db/schema.ts'
import { isLocalUrl } from '../src/lib/local-url.ts'
import { readEnvFile } from './lib/env.ts'
import { createObjectStore, readCredentials } from './lib/object-storage.ts'

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
  /** 本次传给子进程的 --ids 文件。 */
  idsFile?: string
}

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = {
  migrate: join(APP_ROOT, 'scripts', 'db-migrate.ts'),
  ingest: join(APP_ROOT, 'scripts', 'ingest-db.ts'),
  refresh: join(APP_ROOT, 'scripts', 'refresh-public-totals.ts'),
  verify: join(APP_ROOT, 'scripts', 'verify-db.ts'),
  publish: join(APP_ROOT, 'scripts', 'publish-data.ts'),
  transcripts: join(APP_ROOT, 'scripts', 'publish-transcripts.ts'),
  purge: join(APP_ROOT, 'scripts', 'purge-cache.ts'),
}
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')
const IDS_DIR = join(APP_ROOT, 'temp', 'sync-ids')
const PACK_SUFFIX = '.datapack.json'

const USAGE = `用法：bun scripts/sync-remote.ts [选项]

把本地 pack / 封面 / 逐字稿同步到 .dev.vars 指定的线上数据库与对象存储。
只读 .dev.vars 的线上目标（DATABASE_URL_ONLINE / R2_*）。默认只新增缺失场次。

选项：
  --dataset <id>     只同步指定 dataset，可重复
  --update-existing  允许改写已有场次（按内容 hash；默认完全不动旧场次）
  --recent-days <n>  只检查最近 n 天改过的 pack，默认 7；0 表示检查全部
  --skip-migrate     跳过数据库迁移（默认先应用 drizzle/ 迁移）
  --skip-transcripts 跳过逐字稿发布
  --skip-ingest      跳过数据库写入
  --skip-refresh     跳过 dataset_insights.public_totals 刷新
  --skip-verify      跳过 db:verify 对账
  --strict-verify    verify 有差异时立即中止（默认只警告，继续发布）
  --skip-publish     跳过对象存储发布
  --skip-purge       跳过缓存失效
  --skip-compare     跳过同步前的数据量比对（仍会查询新增 ID）
  --force            等同上 --update-existing，并忽略增量判断全量重写
  --dry-run          只打印目标、新增数量与步骤，不执行
  -h, --help         显示本帮助`

const { values } = parseArgs({
  options: {
    dataset: { type: 'string', multiple: true },
    'update-existing': { type: 'boolean' },
    'recent-days': { type: 'string', default: '7' },
    'skip-migrate': { type: 'boolean' },
    'skip-transcripts': { type: 'boolean' },
    'skip-ingest': { type: 'boolean' },
    'skip-refresh': { type: 'boolean' },
    'skip-verify': { type: 'boolean' },
    'strict-verify': { type: 'boolean' },
    'skip-publish': { type: 'boolean' },
    'skip-purge': { type: 'boolean' },
    'skip-compare': { type: 'boolean' },
    force: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})

if (values.help) {
  console.log(USAGE)
  process.exit(0)
}

function fail(message: string): never {
  console.error(`[sync] ${message}`)
  process.exit(1)
}

const envPath = join(APP_ROOT, '.dev.vars')
if (!existsSync(envPath))
  fail('找不到 .dev.vars（线上凭据）；本脚本只认它，不读环境变量里的本机值')

const remote = readEnvFile(envPath)
const databaseUrl = remote.DATABASE_URL_ONLINE
if (!databaseUrl)
  fail('.dev.vars 缺少 DATABASE_URL_ONLINE（线上 Neon）')
if (isLocalUrl(databaseUrl))
  fail(`DATABASE_URL_ONLINE 指向本机（${new URL(databaseUrl).host}），拒绝同步`)

for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
  if (!remote[key])
    fail(`.env 缺少 ${key}`)
}

const sources = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { datasets?: DatasetSource[] }
const all = sources.datasets ?? []
if (all.length === 0)
  fail('data-sources.json 里没有 datasets')

const wanted = values.dataset ?? []
const unknown = wanted.filter(id => !all.some(source => source.id === id))
if (unknown.length > 0)
  fail(`data-sources.json 里没有 dataset：${unknown.join(', ')}`)

const selected = wanted.length > 0 ? all.filter(source => wanted.includes(source.id)) : all
const updateExisting = Boolean(values['update-existing'] || values.force)
const hasTranscripts = !values['skip-transcripts']
const hasPurge = !values['skip-purge']
const dbHost = new URL(databaseUrl).host
const bucket = `${remote.R2_BUCKET}${remote.R2_PREFIX ? `/${remote.R2_PREFIX}` : ''}`

const recentDays = Number(values['recent-days'])
if (!Number.isFinite(recentDays) || recentDays < 0)
  fail('--recent-days 需要是 >= 0 的数字')

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
  const all = names.map(name => name.slice(0, -PACK_SUFFIX.length))
  if (recentDays <= 0)
    return { all, candidates: all }

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
  return { all, candidates }
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
      fail(`读取线上 streams 失败：${error instanceof Error ? error.message : String(error)}`)
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
    fail(`读取线上 streams 数量失败：${error instanceof Error ? error.message : String(error)}`)
  })
const countByDataset = new Map(remoteCounts.map(row => [row.id, Number(row.count)]))

const transcriptCounts = await db
  .select({ id: transcripts.datasetId, count: sql<number>`count(*)::int` })
  .from(transcripts)
  .groupBy(transcripts.datasetId)
  .catch((error: unknown) => {
    fail(`读取线上逐字稿数量失败：${error instanceof Error ? error.message : String(error)}`)
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

console.log('[sync] 线上目标')
console.log(`[sync]   数据库：${dbHost}`)
console.log(`[sync]   对象存储：r2://${bucket}`)
console.log(`[sync]   成员：${plan.map(item => item.source.id).join(', ')}`)
console.log(`[sync]   策略：${updateExisting ? '更新已有 + 新增（按 hash）' : '只新增缺失场次'}`)
console.log(`[sync]   窗口：${recentDays > 0 ? `最近 ${recentDays} 天开播的 pack` : '全部 pack'}（候选 ${plannedCandidates}）`)
console.log(`[sync]   新增场次：${plannedNew}`)
console.log(`[sync]   步骤：${[
  values['skip-migrate'] ? null : 'migrate',
  hasTranscripts ? 'transcripts' : null,
  values['skip-ingest'] ? null : 'ingest',
  values['skip-refresh'] ? null : 'refresh',
  values['skip-verify'] ? null : 'verify',
  values['skip-publish'] ? null : 'publish',
  hasPurge ? 'purge' : null,
].filter(Boolean).join(' → ') || '（无）'}`)

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
  if (!credentials)
    fail('无法构造线上对象存储凭据')

  let objects: Map<string, number>
  try {
    objects = await createObjectStore(credentials).list()
  }
  catch (error) {
    fail(`列远端对象失败：${error instanceof Error ? error.message : String(error)}`)
  }

  console.log('[sync] 数据量对比（本地 / 远端）')
  for (const item of plan) {
    const { source } = item
    const dir = resolve(APP_ROOT, source.datapackDir ?? `data/${source.id}`)
    const thumbs = countFiles(resolve(dir, 'thumbs'), name => name.endsWith('.jpg') || name.endsWith('.webp'))
    const emoji = countFiles(resolve(dir, 'emoji'), name => name.endsWith('.png'))
    const archive = countObjects(objects, `archive/${source.id}/`, PACK_SUFFIX)
    const remoteThumbs = countObjects(objects, `${source.id}/thumbs/`)
    const remoteEmoji = countObjects(objects, `emojis/${source.id}/`, '.png')
    const remoteTranscripts = countObjects(objects, `${source.id}/transcripts/`, '.json')

    console.log(
      `[sync]   ${source.id}: packs ${item.localCount}/${item.remoteCount}（新增 ${item.fresh.length}，候选 ${item.candidates.length}，archive ${archive}）`
      + `  thumbs ${thumbs}/${remoteThumbs}  emoji ${emoji}/${remoteEmoji}`
      + `  transcripts ${item.localTranscripts}/${remoteTranscripts}（库 ${item.remoteTranscripts}）`,
    )
  }
  if (updateExisting)
    console.log('[sync] --update-existing：已有场次会按内容 hash 判断是否重写')
  else
    console.log('[sync] 默认只新增：已有场次不读不写；要刷新旧数据加 --update-existing')
}

if (!values['skip-compare'])
  await compareVolumes()

const affected = updateExisting
  ? plan.filter(item => item.candidates.length > 0)
  : plan.filter(item => item.fresh.length > 0)

if (affected.length > 0 && !values['dry-run']) {
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

if (values['dry-run']) {
  console.log(
    `[sync] dry-run：未执行任何写入；新场次 ${plannedNew} 场（候选 ${plannedCandidates}）`
    + `，逐字稿数量有差异的成员 ${transcriptDiff.length} 个`,
  )
  process.exit(0)
}

// 子进程只继承线上凭据；把 `*_ONLINE` 展开成同名键，并清掉本地端点，
// 避免任何脚本回落到本机服务。
const childEnv: Record<string, string | undefined> = { ...process.env, LOCAL: '0' }
for (const [key, value] of Object.entries(remote)) {
  if (key === 'LOCAL')
    continue
  if (key.endsWith('_ONLINE'))
    childEnv[key.slice(0, -'_ONLINE'.length)] = value
  else if (key !== 'DATABASE_URL')
    childEnv[key] = value
}
childEnv.LOCAL = '0'
for (const key of [
  'DATABASE_URL_ONLINE',
  'NEON_HTTP_ENDPOINT',
  'S3_ENDPOINT',
  'MINIO_ENDPOINT',
  'SILO_BIN',
  'SILO_DATA',
  'MINIO_ROOT_USER',
  'MINIO_ROOT_PASSWORD',
]) {
  delete childEnv[key]
}

async function run(label: string, script: string, args: string[]): Promise<number> {
  console.log(`\n[sync] === ${label} ===`)
  return await new Promise<number>((resolveCode, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: APP_ROOT,
      env: childEnv,
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('close', value => resolveCode(value ?? 1))
  })
}

async function runOrFail(label: string, script: string, args: string[]): Promise<void> {
  const code = await run(label, script, args)
  if (code !== 0)
    fail(`${label} 失败（exit ${code}）`)
}

if (!values['skip-migrate'])
  await runOrFail('数据库迁移', SCRIPT.migrate, [])

if (hasTranscripts)
  await runOrFail('逐字稿', SCRIPT.transcripts, [])

if (affected.length === 0) {
  console.log('\n[sync] 没有新增场次；默认不改写已有数据，跳过 ingest / refresh / verify / publish / purge')
  process.exit(0)
}

const selectors = affected.flatMap(item => ['--dataset', item.source.id])

if (!values['skip-ingest']) {
  for (const item of affected) {
    const args = ['--dataset', item.source.id, ...(item.idsFile ? ['--ids', item.idsFile] : [])]
    if (!updateExisting)
      args.push('--new-only')
    if (values.force)
      args.push('--force')
    await runOrFail(`ingest ${item.source.id}`, SCRIPT.ingest, args)
  }
}

if (!values['skip-refresh'])
  await runOrFail('刷新公开汇总', SCRIPT.refresh, selectors)

let verifyFailures = 0
if (!values['skip-verify']) {
  for (const item of affected) {
    const args = ['--dataset', item.source.id, ...(item.idsFile ? ['--ids', item.idsFile] : [])]
    const code = await run(`verify ${item.source.id}`, SCRIPT.verify, args)
    if (code === 0) continue
    verifyFailures += 1
    if (values['strict-verify'])
      fail(`verify ${item.source.id} 失败（exit ${code}）`)
    console.warn(`[sync] verify ${item.source.id} 有差异（exit ${code}），继续发布；严格模式加 --strict-verify`)
  }
}

if (!values['skip-publish']) {
  for (const item of affected) {
    await runOrFail(
      `publish ${item.source.id}`,
      SCRIPT.publish,
      [
        '--dataset', item.source.id,
        '--adopt-remote',
        ...(item.idsFile ? ['--ids', item.idsFile] : []),
        ...(values.force ? ['--force'] : []),
      ],
    )
  }
}

if (hasPurge) {
  const args = [...selectors]
  if (hasTranscripts)
    args.push('--tags', 'transcripts')
  await runOrFail('缓存失效', SCRIPT.purge, args)
}

if (verifyFailures > 0) {
  console.warn(`\n[sync] 完成，但 ${verifyFailures} 个成员的 verify 有差异；修完可重跑 verify`)
  process.exitCode = 1
}
else {
  console.log('\n[sync] 完成')
}
