/**
 * 清理 `scheduled_streams`：这张表只保留还没入库的未来场。
 *
 * 默认 dry-run，只列出会删除 / 会合并的行；加 `--apply` 才写库。
 * 目标环境沿用 `LOCAL` 开关：`.dev.vars` 里 `LOCAL=1` 走本机库，`LOCAL=0` 走 `*_ONLINE`。
 *
 *   bun scripts/prune-schedules.ts
 *   bun scripts/prune-schedules.ts --apply
 *   LOCAL=0 bun scripts/prune-schedules.ts --apply --dataset miyako
 */
import process from 'node:process'
import { parseArgs } from 'node:util'
import { createDb } from '../src/db/connection.ts'
import { scheduledStreams } from '../src/db/schema.ts'
import { loadEnvFiles, requireEnv } from './lib/env.ts'
import { normalizeScheduleKeys, pruneMatchedSchedules } from './lib/schedule-match.ts'

const USAGE = `用法：bun scripts/prune-schedules.ts [选项]

删除已经有对应 streams 行的日程，并把 yt: 行归一为日期 + 时段自然键。

选项：
  --apply            实际写库；省略时只打印计划（dry-run）
  --dataset <id>     只处理指定成员；省略会处理日程表里的全部成员
  -h, --help         显示本帮助

环境：
  沿用 LOCAL 开关；LOCAL=0 时使用 .dev.vars 的 DATABASE_URL_ONLINE。`

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean' },
    dataset: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})

if (values.help) {
  console.log(USAGE)
  process.exit(0)
}

const REASON_LABELS = {
  video: 'video_id',
  url: '链接',
  'date-slot': '日期+时段',
} as const

loadEnvFiles({ prefix: 'prune' })
const db = createDb(requireEnv('DATABASE_URL'))
const now = new Date()
const dryRun = !values.apply

const datasetIds = values.dataset
  ? [values.dataset]
  : (await db
    .selectDistinct({ datasetId: scheduledStreams.datasetId })
    .from(scheduledStreams)
    .orderBy(scheduledStreams.datasetId))
    .map(row => row.datasetId)

let prunedTotal = 0
let renamedTotal = 0
let mergedTotal = 0

for (const datasetId of datasetIds) {
  const pruned = await pruneMatchedSchedules(db, datasetId, now, { dryRun })
  const prunedKeys = new Set(pruned.map(entry => entry.eventKey))
  const consolidation = (await normalizeScheduleKeys(db, datasetId, now, { dryRun }))
    .filter(entry => dryRun
      ? !prunedKeys.has(entry.eventKey) && !prunedKeys.has(entry.targetEventKey)
      : true)
  const renamed = consolidation.filter(entry => entry.action === 'rename')
  const merged = consolidation.filter(entry => entry.action === 'merge')

  prunedTotal += pruned.length
  renamedTotal += renamed.length
  mergedTotal += merged.length
  if (pruned.length === 0 && consolidation.length === 0) continue

  console.log(`[prune] ${datasetId}：删除 ${pruned.length}，归一 ${renamed.length}，合并 ${merged.length}`)
  for (const entry of pruned) {
    console.log(`  - ${entry.eventKey}  已入库（${REASON_LABELS[entry.reason]} ${entry.videoId}）`)
  }
  for (const entry of renamed) {
    console.log(`  → ${entry.eventKey} → ${entry.targetEventKey}  统一为日期+时段`)
  }
  for (const entry of merged) {
    const filled = Object.keys(entry.patch)
    console.log(
      `  ~ ${entry.eventKey} → ${entry.targetEventKey}`
      + (filled.length ? `  补齐 ${filled.join(', ')}` : ''),
    )
  }
}

console.log(JSON.stringify({
  mode: dryRun ? 'dry-run' : 'apply',
  datasets: datasetIds.length,
  pruned: prunedTotal,
  renamed: renamedTotal,
  merged: mergedTotal,
}, null, 2))

if (dryRun) console.log('[prune] dry-run：加 --apply 才会写库')
