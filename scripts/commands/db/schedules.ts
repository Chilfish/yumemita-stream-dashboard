/**
 * 清理 `scheduled_streams`：这张表只保留还没入库的未来场。
 *
 * 默认 dry-run，只列出会删除 / 会合并的行；加 `--apply` 才写库。
 * 目标环境沿用 `LOCAL` 开关：`LOCAL=1` 叠加 `.dev.vars.dev` 走本机库，`LOCAL=0` 叠加 `.dev.vars.prod`。
 *
 *   bun run ymmt db schedules
 *   bun run ymmt db schedules --apply
 *   LOCAL=0 bun run ymmt db schedules --apply --dataset miyako
 */
import { Option } from 'commander'
import { type CommandSpec, requireEnvVar, type Logger } from '@chilfish/devkit/cli'
import { createDb, type Db } from '@/db/connection.ts'
import { scheduledStreams } from '@/db/schema.ts'
import { normalizeScheduleKeys, pruneMatchedSchedules } from '@scripts/lib/schedule-match.ts'

/** 只取命令需要的日志通道；默认空操作。 */
export type SchedulesLog = Pick<Logger, 'info' | 'warn' | 'error' | 'line'>

const NOOP_LOG: SchedulesLog = { info: () => {}, warn: () => {}, error: () => {}, line: () => {} }

export interface PruneSchedulesOptions {
  /** 实际写库；省略时只打印计划。 */
  apply?: boolean
  /** 只处理指定成员；省略会处理日程表里的全部成员。 */
  dataset?: string
  /** 全局 `--dry-run`：即使带 `--apply` 也只打印计划。 */
  dryRun?: boolean
  log?: SchedulesLog
}

export interface PruneSchedulesResult {
  exitCode: number
  data: {
    mode: 'dry-run' | 'apply'
    datasets: number
    pruned: number
    renamed: number
    merged: number
  }
}

const REASON_LABELS = {
  video: 'video_id',
  url: '链接',
  'date-slot': '日期+时段',
} as const

const DATABASE_HINT = '在 .dev.vars 配置 DATABASE_URL；本地可先运行 bun run ymmt dev db'

async function selectDatasetIds(db: Db, dataset?: string): Promise<string[]> {
  if (dataset) return [dataset]
  const rows = await db
    .selectDistinct({ datasetId: scheduledStreams.datasetId })
    .from(scheduledStreams)
    .orderBy(scheduledStreams.datasetId)
  return rows.map(row => row.datasetId)
}

/**
 * 删除已入库的日程，并把 `yt:` 行归一到日期 + 时段自然键。
 *
 * 默认只读；`apply` 且非全局 dry-run 时才写库。
 */
export async function runPruneSchedules(options: PruneSchedulesOptions = {}): Promise<PruneSchedulesResult> {
  const log = options.log ?? NOOP_LOG
  const dryRun = options.dryRun === true || options.apply !== true
  const db = createDb(requireEnvVar('DATABASE_URL', DATABASE_HINT))
  const now = new Date()

  const datasetIds = await selectDatasetIds(db, options.dataset)

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

    log.info(`[prune] ${datasetId}：删除 ${pruned.length}，归一 ${renamed.length}，合并 ${merged.length}`)
    for (const entry of pruned) {
      log.line(`  - ${entry.eventKey}  已入库（${REASON_LABELS[entry.reason]} ${entry.videoId}）`)
    }
    for (const entry of renamed) {
      log.line(`  → ${entry.eventKey} → ${entry.targetEventKey}  统一为日期+时段`)
    }
    for (const entry of merged) {
      const filled = Object.keys(entry.patch)
      log.line(
        `  ~ ${entry.eventKey} → ${entry.targetEventKey}`
        + (filled.length ? `  补齐 ${filled.join(', ')}` : ''),
      )
    }
  }

  if (dryRun) log.info('[prune] dry-run：加 --apply 才会写库')

  return {
    exitCode: 0,
    data: {
      mode: dryRun ? 'dry-run' : 'apply',
      datasets: datasetIds.length,
      pruned: prunedTotal,
      renamed: renamedTotal,
      merged: mergedTotal,
    },
  }
}

/** 清理已入库日程、归一自然键；默认 dry-run，`--apply` 才写库。 */
export const dbSchedulesSpec: CommandSpec = {
  id: 'db.schedules',
  description: '清理已入库日程、归一自然键（默认 dry-run）',
  details: '删除已经有对应 streams 行的日程，并把 yt: 行归一为日期 + 时段自然键。\n'
    + '默认只打印计划；加 --apply 才写库。目标环境沿用 LOCAL 开关（LOCAL=0 叠加 .dev.vars.prod）。',
  examples: [
    'bun run ymmt db schedules',
    'bun run ymmt db schedules --apply',
    'LOCAL=0 bun run ymmt db schedules --apply --dataset miyako',
    'bun run ymmt db schedules --json',
  ],
  options: [
    new Option('--apply', '实际写库；省略时只打印计划（dry-run）'),
    new Option('--dataset <id>', '只处理指定成员；省略会处理日程表里的全部成员'),
  ],
  async run(ctx) {
    const result = await runPruneSchedules({
      apply: ctx.flag('apply'),
      ...(typeof ctx.options.dataset === 'string' ? { dataset: ctx.options.dataset } : {}),
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    const { data } = result
    return {
      exitCode: result.exitCode,
      data,
      summary: `${data.mode === 'dry-run' ? 'dry-run（未写库）' : '已写库'}：`
        + `${data.datasets} 个成员，删除 ${data.pruned}，归一 ${data.renamed}，合并 ${data.merged}`,
    }
  },
}
