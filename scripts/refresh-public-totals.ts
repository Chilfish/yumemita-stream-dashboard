#!/usr/bin/env bun
/**
 * 重算 `dataset_insights.public_totals`，不改 streams / 明细。
 *
 * 聚合口径或 Top 列表排序改变后，用它同步派生数据：
 *
 *   bun scripts/refresh-public-totals.ts
 *   bun scripts/refresh-public-totals.ts --dataset arale
 *
 * 读取走 `createDb()`（本地 pg / 线上 neon-http），写入走 `createWriteDb()`。
 * 需要 DATABASE_URL；本地库与线上库由环境变量决定。
 */
import process from 'node:process'
import { parseArgs } from 'node:util'
import { eq } from 'drizzle-orm'
import { createDb, createWriteDb } from '../src/db/connection.ts'
import { computeDatasetPublicTotals } from '../src/db/queries/dataset-totals.ts'
import { datasetInsights, datasets } from '../src/db/schema.ts'
import { loadEnvFiles, requireEnv } from './lib/env.ts'

const { values } = parseArgs({
  options: {
    dataset: { type: 'string', multiple: true },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})

if (values.help) {
  console.log(`用法：bun scripts/refresh-public-totals.ts [选项]

选项：
  --dataset <id>  只刷新指定成员（可重复）
  -h, --help      显示本帮助`)
  process.exit(0)
}

loadEnvFiles()
const url = requireEnv('DATABASE_URL')
const readDb = createDb(url)
const { db: writeDb, pool } = createWriteDb(url)

try {
  const rows = await readDb.select({ id: datasets.id }).from(datasets).orderBy(datasets.id)
  const selected = values.dataset?.length
    ? rows.filter(row => values.dataset.includes(row.id))
    : rows

  if (selected.length === 0) {
    throw new Error(values.dataset?.length ? `找不到成员：${values.dataset.join(', ')}` : '没有成员')
  }

  let updated = 0
  for (const row of selected) {
    const publicTotals = await computeDatasetPublicTotals(readDb, row.id)
    const result = await writeDb
      .update(datasetInsights)
      .set({ publicTotals, generatedAt: new Date() })
      .where(eq(datasetInsights.datasetId, row.id))
      .returning({ datasetId: datasetInsights.datasetId })

    if (result.length === 0) {
      console.warn(`[refresh] ${row.id}: 缺少 dataset_insights，先跑 db:ingest`)
      continue
    }

    updated += 1
    console.log(
      `[refresh] ${row.id}: ${publicTotals.streamCount} 场 / ${JSON.stringify(publicTotals).length} B`,
    )
  }

  console.log(`[refresh] 完成：${updated}/${selected.length}`)
}
finally {
  await pool.end()
}
