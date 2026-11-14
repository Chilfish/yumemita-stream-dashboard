import { Option } from 'commander'
import type { CommandSpec } from '@scripts/lib/cli/runtime.ts'
import { CliError, requireEnvVar } from '@scripts/lib/cli/exit.ts'
import { desc, eq } from 'drizzle-orm'
import { createDb } from '@/db/connection.ts'
import { streams } from '@/db/schema.ts'

/** 数据库里最新一场的 videoId；数据工作流的 yt-dlp 探针。 */
export const dbLatestSpec: CommandSpec = {
  id: 'db.latest',
  description: '输出数据库里最新一场的 videoId（工作流探针）',
  details: '只输出裸 videoId 一行，方便 CI 里 `probe=$(...)` 直接取用。\n数据库为空时退出码 1。',
  examples: [
    'bun run ymmt db latest',
    'bun run ymmt db latest --dataset nonoka',
  ],
  options: [new Option('--dataset <id>', '只看指定 dataset')],
  async run(ctx) {
    const dataset = ctx.options.dataset
    const db = createDb(requireEnvVar('DATABASE_URL', '在 .dev.vars 配置 DATABASE_URL；本地可先运行 bun run dev:db'))
    const [row] = await db
      .select({ videoId: streams.videoId })
      .from(streams)
      .where(typeof dataset === 'string' ? eq(streams.datasetId, dataset) : undefined)
      .orderBy(desc(streams.startedAt))
      .limit(1)

    if (!row) {
      throw new CliError('数据库里没有场次', {
        code: 'EMPTY_DATABASE',
        hint: '先运行 bun run ymmt db ingest 写入本地 pack',
      })
    }
    ctx.log.output(row.videoId)
    return { data: { videoId: row.videoId } }
  },
}
