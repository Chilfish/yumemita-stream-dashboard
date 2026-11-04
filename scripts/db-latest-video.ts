#!/usr/bin/env bun
/**
 * 输出数据库里最新一场的 videoId；数据工作流用它做 yt-dlp 探针。
 *
 *   bun scripts/db-latest-video.ts
 *   bun scripts/db-latest-video.ts --dataset nonoka
 */
import { parseArgs } from 'node:util'
import { desc, eq } from 'drizzle-orm'
import { createDb } from '../src/db/connection.ts'
import { streams } from '../src/db/schema.ts'
import { loadEnvFiles, requireEnv } from './lib/env.ts'

loadEnvFiles()

const { values } = parseArgs({
  options: {
    dataset: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})

if (values.help) {
  console.log('用法：bun scripts/db-latest-video.ts [--dataset <id>]')
  process.exit(0)
}

const db = createDb(requireEnv('DATABASE_URL'))

const [row] = await db
  .select({ videoId: streams.videoId })
  .from(streams)
  .where(values.dataset ? eq(streams.datasetId, values.dataset) : undefined)
  .orderBy(desc(streams.startedAt))
  .limit(1)

if (!row) {
  console.error('[db-latest-video] 数据库里没有场次')
  process.exit(1)
}

console.log(row.videoId)
