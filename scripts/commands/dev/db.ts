import process from 'node:process'
import { Option } from 'commander'
import type { CommandSpec } from '@scripts/lib/cli/runtime.ts'
import { createLogger, type Logger } from '@scripts/lib/cli/logger.ts'
import {
  applyMigrations,
  DEFAULT_DATABASE_URL,
  ensureDevDatabase,
  ensureDevVars,
  ensurePostgresRunning,
} from '@scripts/lib/dev-services.ts'

/**
 * 只做本地库初始化：启动 Postgres、建库、跑迁移、把 `.dev.vars` 指到本机。
 *
 * 不启动 Astro；`bun run ymmt dev` 会自动走同一条路径。
 */
export interface DevDbOptions {
  /** 目标数据库地址，默认 `DEFAULT_LOCAL_DATABASE_URL`。 */
  url?: string
  /** 全局 --dry-run：只报告将要做什么，不启服务、不写库、不改 `.dev.vars`。 */
  dryRun?: boolean
  log?: Logger
}

export interface DevDbData {
  url: string
  applied: boolean
  steps: string[]
}

export interface DevDbResult {
  exitCode: number
  data: DevDbData
}

export async function runDevDb(options: DevDbOptions): Promise<DevDbResult> {
  const log = options.log ?? createLogger({ name: 'dev.db' })
  const url = options.url ?? DEFAULT_DATABASE_URL
  const steps = ['ensurePostgresRunning', 'ensureDevDatabase', 'applyMigrations', 'ensureDevVars']

  if (options.dryRun) {
    log.info(`dry-run：将初始化 ${url}（${steps.join(' → ')}），不启服务、不写库、不改 .dev.vars`)
    return { exitCode: 0, data: { url, applied: false, steps } }
  }

  ensurePostgresRunning(url)
  await ensureDevDatabase(url)
  await applyMigrations(url)
  ensureDevVars(url, process.env.NEON_HTTP_ENDPOINT ?? 'http://127.0.0.1:4444/sql')
  log.info('数据库与迁移就绪')

  log.line(`
下一步：
  1. 启动开发服务器：bun run dev    # 自动拉起 Postgres 与开发代理
  2. 灌入本地数据：bun run ymmt data update --dataset nonoka   # 首次较慢
`)

  return { exitCode: 0, data: { url, applied: true, steps } }
}

export const devDbSpec: CommandSpec = {
  id: 'dev.db',
  description: '本地库初始化：启动 Postgres、建库、跑迁移、对齐 .dev.vars',
  details: '不启动 Astro。默认地址 `postgres://postgres@localhost:5432/ymmt_dev`。\n'
    + '全局 `--dry-run` 只报告将要执行的步骤，不启服务、不写库、不改 `.dev.vars`。',
  examples: [
    'bun run ymmt dev db',
    'bun run ymmt dev db --url postgres://postgres@localhost:5432/ymmt_dev',
  ],
  options: [new Option('--url <url>', '目标数据库地址，默认本机 ymmt_dev')],
  async run(ctx) {
    const url = ctx.options.url
    const result = await runDevDb({
      url: typeof url === 'string' && url.length > 0 ? url : undefined,
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    return { exitCode: result.exitCode, data: result.data }
  },
}
