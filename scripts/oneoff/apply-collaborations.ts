#!/usr/bin/env bun
/**
 * 一次性迁移：把 `content/collaborations.json` 的参与者写进目标库。
 *
 * 用于已经部署、但没有跑过联动回填的环境（线上 Neon）。不读 pack、不建场次：
 * 只更新 `streams.participants`，找不到的 videoId 会列出来（先跑 sync:remote 补场次）。
 * 写完统一重算 `dataset_insights.public_totals`，成员页数字才会跟上。
 *
 * 用法：
 *   bun scripts/apply-collaborations.ts --dry-run             # 看目标、命中与缺失
 *   LOCAL=0 bun scripts/apply-collaborations.ts               # 写线上
 *   bun scripts/apply-collaborations.ts --skip-migrate        # 已手动迁移过
 *   bun scripts/apply-collaborations.ts --verify              # 写完后对账
 *
 * 幂等：已经是目标值的场次跳过；重复运行不会产生额外写入。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { and, eq, inArray } from 'drizzle-orm'
import { createDb, createWriteDb } from '../src/db/connection.ts'
import { streams } from '../src/db/schema.ts'
import { loadCollaborations } from './lib/collaborations.ts'
import { loadEnvFiles, requireEnv } from './lib/env.ts'

const USAGE = `用法：bun scripts/apply-collaborations.ts [选项]

把 content/collaborations.json 的 participants 写进 DATABASE_URL 指向的库。
不读 pack、不建场次；写完刷新 dataset_insights.public_totals。

选项：
  --dry-run       只读：打印目标、需更新数量与缺失场次
  --skip-migrate  跳过 drizzle 迁移（默认先应用）
  --skip-refresh  跳过 public_totals 重算
  --verify        写完后按 dataset 跑 db:verify
  -h, --help      显示本帮助`

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean' },
    'skip-migrate': { type: 'boolean' },
    'skip-refresh': { type: 'boolean' },
    verify: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})

if (values.help) {
  console.log(USAGE)
  process.exit(0)
}

interface DataSource {
  id: string
}

interface PlannedRow {
  videoId: string
  /** 频道主；写入时一起匹配，避免跨 dataset 误改。 */
  ownerId: string
  participants: string[]
}

const script = (name: string) => resolve('scripts', name)

function run(label: string, file: string, args: string[] = []): number {
  console.log(`\n[apply] === ${label} ===`)
  const result = spawnSync(process.execPath, [script(file), ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  return result.status ?? 1
}

loadEnvFiles({ prefix: 'apply' })
const url = requireEnv('DATABASE_URL')
const { datasets } = JSON.parse(readFileSync('data-sources.json', 'utf8')) as { datasets: DataSource[] }
const known = datasets.map(dataset => dataset.id)
const collaboration = loadCollaborations({ knownDatasetIds: known })

const planned: PlannedRow[] = [...collaboration.byVideo].map(([videoId, participants]) => ({
  videoId,
  ownerId: '',
  participants,
}))
if (planned.length === 0) {
  console.warn('[apply] content/collaborations.json 里没有可写入的登记')
  process.exit(0)
}

const readDb = createDb(url)
const ids = planned.map(row => row.videoId)
const remoteRows = await readDb
  .select({
    videoId: streams.videoId,
    datasetId: streams.datasetId,
    participants: streams.participants,
  })
  .from(streams)
  .where(inArray(streams.videoId, ids))

const remoteById = new Map(remoteRows.map(row => [row.videoId, row]))
const missing: PlannedRow[] = []
const conflicts: string[] = []
const updates: (PlannedRow & { current: string[] })[] = []
let unchanged = 0

for (const row of planned) {
  const remote = remoteById.get(row.videoId)
  if (!remote) {
    missing.push(row)
    continue
  }
  row.ownerId = remote.datasetId
  if (row.participants.includes(remote.datasetId)) {
    conflicts.push(`${row.videoId}：频道主 ${remote.datasetId} 不能同时是参与者`)
    continue
  }
  const current = remote.participants ?? []
  if (current.length === row.participants.length && current.every((id, index) => id === row.participants[index])) {
    unchanged += 1
    continue
  }
  updates.push({ ...row, current })
}

console.log(`\n[apply] 登记 ${planned.length} 场；库里命中 ${remoteById.size} 场`)
console.log(`[apply] 需更新 ${updates.length} 场，已是目标值 ${unchanged} 场，缺失 ${missing.length} 场`)
for (const row of updates.slice(0, 20)) {
  console.log(`[apply]   ${row.videoId} ${row.ownerId}: [${row.current.join(', ')}] → [${row.participants.join(', ')}]`)
}
if (updates.length > 20)
  console.log(`[apply]   …其余 ${updates.length - 20} 场略`)
if (missing.length > 0) {
  console.warn('[apply] 库里没有这些场次；先补 pack（sync:remote）再重跑：')
  for (const row of missing.slice(0, 30)) console.warn(`[apply]   缺 ${row.videoId}（[${row.participants.join(', ')}]）`)
  if (missing.length > 30)
    console.warn(`[apply]   …其余 ${missing.length - 30} 场略`)
}
if (conflicts.length > 0) {
  console.warn('[apply] 跳过冲突登记：')
  for (const message of conflicts) console.warn(`[apply]   ${message}`)
}

if (values['dry-run']) {
  console.log('[apply] dry-run：未写入')
  process.exit(0)
}

if (!values['skip-migrate']) {
  const code = run('数据库迁移', 'db-migrate.ts')
  if (code !== 0) {
    console.error('[apply] 迁移失败；可先手动 bun run db:migrate 后加 --skip-migrate 重跑')
    process.exit(code)
  }
}

if (updates.length > 0) {
  const { db, pool } = createWriteDb(url)
  try {
    await db.transaction(async (tx) => {
      for (const row of updates) {
        await tx
          .update(streams)
          .set({ participants: row.participants, updatedAt: new Date() })
          .where(and(eq(streams.videoId, row.videoId), eq(streams.datasetId, row.ownerId)))
      }
    })
    console.log(`\n[apply] 已写入 ${updates.length} 场`)
  }
  finally {
    await pool.end()
  }
}

if (!values['skip-refresh']) {
  const code = run('刷新公开汇总', 'refresh-public-totals.ts')
  if (code !== 0) {
    console.warn('[apply] public_totals 刷新失败；可手动重跑 bun scripts/refresh-public-totals.ts')
    process.exitCode = code
  }
}

if (values.verify) {
  for (const dataset of datasets) {
    const code = run(`verify ${dataset.id}`, 'verify-db.ts', ['--dataset', dataset.id])
    if (code !== 0) {
      console.warn(`[apply] verify ${dataset.id} 有差异（exit ${code}）；先确认是否为既有差异`)
      process.exitCode = code
    }
  }
}

console.log(
  `\n[apply] 完成：写入 ${updates.length} 场，跳过 ${unchanged} 场，缺失 ${missing.length} 场`,
)
