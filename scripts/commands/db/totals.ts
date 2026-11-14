/**
 * 重算 `dataset_insights.public_totals`，不改 streams / 明细。
 *
 * 聚合口径或 Top 列表排序改变后，用它同步派生数据：
 *
 *   bun run ymmt db totals
 *   bun run ymmt db totals --dataset arale
 *
 * 读取走 `createDb()`（本地 pg / 线上 neon-http），写入走 `createWriteDb()`。
 * 需要 DATABASE_URL；本地库与线上库由环境变量决定。
 */
import { eq } from 'drizzle-orm'
import { Option } from 'commander'
import type { CommandSpec } from '@scripts/lib/cli/runtime.ts'
import { CliError, requireEnvVar } from '@scripts/lib/cli/exit.ts'
import type { Logger } from '@scripts/lib/cli/logger.ts'
import { createDb, createWriteDb } from '@/db/connection.ts'
import { computeDatasetPublicTotals } from '@/db/queries/dataset-totals.ts'
import { datasetInsights, datasets } from '@/db/schema.ts'

/** 只取命令需要的日志通道；默认空操作。 */
export type TotalsLog = Pick<Logger, 'info' | 'warn' | 'error' | 'line'>

const NOOP_LOG: TotalsLog = { info: () => {}, warn: () => {}, error: () => {}, line: () => {} }

export interface RefreshTotalsOptions {
  /** 只刷新指定成员；commander 对重复的 `--dataset` 给数组，只写一次时给字符串。 */
  dataset?: string | string[]
  /** 全局 `--dry-run`：只重算并打印字节数，不写库。 */
  dryRun?: boolean
  log?: TotalsLog
}

export interface RefreshTotalsResult {
  exitCode: number
  data: {
    mode: 'dry-run' | 'apply'
    datasets: number
    updated: number
    /** 有成员但缺 dataset_insights 行的 id。 */
    missing: string[]
    rows: { id: string, streamCount: number, bytes: number }[]
  }
}

const DATABASE_HINT = '在 .dev.vars 配置 DATABASE_URL；本地可先运行 bun run ymmt dev db'

/** `--dataset` 出现一次是 string、出现多次是 string[]；统一成数组。 */
function toList(value: string | string[] | undefined): string[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * 逐成员重算 `public_totals` 并写回。
 *
 * 缺 insights 行的成员只记警告、不中断其余成员（与原脚本一致）。
 */
export async function runRefreshTotals(options: RefreshTotalsOptions = {}): Promise<RefreshTotalsResult> {
  const log = options.log ?? NOOP_LOG
  const dryRun = options.dryRun === true
  const wanted = toList(options.dataset)
  const url = requireEnvVar('DATABASE_URL', DATABASE_HINT)
  const readDb = createDb(url)
  const { db: writeDb, pool } = createWriteDb(url)

  try {
    const rows = await readDb.select({ id: datasets.id }).from(datasets).orderBy(datasets.id)
    const selected = wanted.length
      ? rows.filter(row => wanted.includes(row.id))
      : rows

    if (selected.length === 0) {
      throw new CliError(
        wanted.length ? `找不到成员：${wanted.join(', ')}` : '没有成员',
        {
          code: 'UNKNOWN_DATASET',
          hint: wanted.length
            ? '查可用成员：jq -r ".datasets[].id" data-sources.json，再去掉拼错的 --dataset'
            : '先运行 bun run ymmt db ingest --dataset nonoka 建库',
          ...(wanted.length > 0 ? { context: { dataset: wanted } } : {}),
        },
      )
    }

    let updated = 0
    const missing: string[] = []
    const measured: { id: string, streamCount: number, bytes: number }[] = []

    for (const row of selected) {
      const publicTotals = await computeDatasetPublicTotals(readDb, row.id)
      const bytes = JSON.stringify(publicTotals).length
      measured.push({ id: row.id, streamCount: publicTotals.streamCount, bytes })

      // dry-run 不写库，但仍查一次 insights 行是否存在，保证 missing 统计一致。
      const result = dryRun
        ? await readDb
          .select({ datasetId: datasetInsights.datasetId })
          .from(datasetInsights)
          .where(eq(datasetInsights.datasetId, row.id))
          .limit(1)
        : await writeDb
          .update(datasetInsights)
          .set({ publicTotals, generatedAt: new Date() })
          .where(eq(datasetInsights.datasetId, row.id))
          .returning({ datasetId: datasetInsights.datasetId })

      if (result.length === 0) {
        missing.push(row.id)
        log.warn(`[refresh] ${row.id}: 缺少 dataset_insights，先跑 db:ingest`)
        continue
      }

      updated += 1
      log.info(`[refresh] ${row.id}: ${publicTotals.streamCount} 场 / ${bytes} B`)
    }

    log.info(`[refresh] 完成：${updated}/${selected.length}`)
    if (dryRun) log.info('[refresh] dry-run：未写库')

    return {
      exitCode: 0,
      data: {
        mode: dryRun ? 'dry-run' : 'apply',
        datasets: selected.length,
        updated,
        missing,
        rows: measured,
      },
    }
  }
  finally {
    await pool.end()
  }
}

/** 只重算 `dataset_insights.public_totals`。 */
export const dbTotalsSpec: CommandSpec = {
  id: 'db.totals',
  description: '只重算 dataset_insights.public_totals',
  details: '聚合口径或 Top 列表排序改变后同步派生数据；不动 streams 与明细表。\n'
    + '缺 dataset_insights 行的成员只记警告，不影响其余成员。`--dataset` 可重复。',
  examples: [
    'bun run ymmt db totals',
    'bun run ymmt db totals --dataset arale',
    'bun run ymmt db totals --dataset arale --dataset nonoka',
    'bun run ymmt db totals --json',
  ],
  options: [
    new Option('--dataset <id>', '只刷新指定成员（可重复）').argParser(
      (value: string, previous: string | string[] | undefined): string[] => {
        const list = previous === undefined ? [] : Array.isArray(previous) ? previous : [previous]
        return [...list, value]
      },
    ),
  ],
  async run(ctx) {
    const dataset = ctx.options.dataset
    const result = await runRefreshTotals({
      ...(dataset === undefined ? {} : { dataset: dataset as string | string[] }),
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    return {
      exitCode: result.exitCode,
      data: result.data,
      summary: `${result.data.mode === 'dry-run' ? 'dry-run 未写库' : '已写库'}：`
        + `${result.data.updated}/${result.data.datasets} 个成员`
        + (result.data.missing.length > 0 ? `（缺 insights：${result.data.missing.join(', ')}）` : ''),
    }
  },
}
