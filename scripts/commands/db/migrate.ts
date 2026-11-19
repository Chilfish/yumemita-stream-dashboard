/**
 * 应用 drizzle 迁移：`drizzle/` 下的 SQL 跑到 `DATABASE_URL` 指向的库。
 *
 * 本地（localhost）走 `pg` 直连，线上走 Neon serverless Pool；
 * 两条分支的迁移算法与原脚本一致，只是换了入口。
 */
import { type CommandSpec, requireEnvVar, type Logger } from '@chilfish/devkit/cli'
import { isLocalDatabaseUrl } from '@/db/connection.ts'

/** 只取命令需要的日志通道；默认空操作。 */
export type MigrateLog = Pick<Logger, 'info' | 'warn' | 'error' | 'line'>

const NOOP_LOG: MigrateLog = { info: () => {}, warn: () => {}, error: () => {}, line: () => {} }

export interface MigrateOptions {
  /** 只打印目标、不写库（全局 `--dry-run`）。 */
  dryRun?: boolean
  log?: MigrateLog
}

export interface MigrateResult {
  exitCode: number
  data: {
    applied: boolean
    target: 'local-postgres' | 'neon-serverless'
    migrationsFolder: string
    database: string
  }
}

const MIGRATIONS_FOLDER = 'drizzle'
const DATABASE_HINT = '在 .dev.vars 配置 DATABASE_URL；本地可先运行 bun run ymmt dev db'

export const dbMigrateSpec: CommandSpec = {
  id: 'db.migrate',
  description: '应用 drizzle 迁移',
  details: `把 \`${MIGRATIONS_FOLDER}/\` 里的 SQL 应用到 DATABASE_URL。`
    + '\n本地地址走 pg 直连，其它地址走 Neon serverless；迁移只前滚，回滚请手工写 SQL。',
  examples: [
    'bun run ymmt db migrate',
    'bun run ymmt db migrate --json',
  ],
  options: [],
  async run(ctx) {
    const result = await runMigrate({ dryRun: ctx.dryRun, log: ctx.log })
    return {
      exitCode: result.exitCode,
      data: result.data,
      summary: result.data.applied
        ? `迁移完成（${result.data.target}，${result.data.database}）`
        : `dry-run：未应用迁移（${result.data.target}，${result.data.database}）`,
    }
  },
}

/**
 * 应用迁移。`dryRun` 时只解析目标库名、不写库。
 *
 * 缺 `DATABASE_URL` 时抛 `ConfigError`（退出码 3）。
 */
export async function runMigrate(options: MigrateOptions = {}): Promise<MigrateResult> {
  const log = options.log ?? NOOP_LOG
  const url = requireEnvVar('DATABASE_URL', DATABASE_HINT)
  const database = new URL(url).pathname.replace(/^\//, '') || '(default)'
  const target = isLocalDatabaseUrl(url) ? 'local-postgres' as const : 'neon-serverless' as const

  if (options.dryRun) {
    log.info(`dry-run：不应用迁移（${target}，${database}）`)
    return {
      exitCode: 0,
      data: { applied: false, target, migrationsFolder: MIGRATIONS_FOLDER, database },
    }
  }

  if (target === 'local-postgres') {
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    const { Pool } = await import('pg')
    const pool = new Pool({ connectionString: url })

    try {
      await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_FOLDER })
      log.info('migration complete（local postgres）')
    }
    finally {
      await pool.end()
    }
  }
  else {
    const { Pool } = await import('@neondatabase/serverless')
    const { drizzle } = await import('drizzle-orm/neon-serverless')
    const { migrate } = await import('drizzle-orm/neon-serverless/migrator')
    const pool = new Pool({ connectionString: url })
    const db = drizzle({ client: pool })

    try {
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
      log.info('migration complete')
    }
    finally {
      await pool.end()
    }
  }

  return {
    exitCode: 0,
    data: { applied: true, target, migrationsFolder: MIGRATIONS_FOLDER, database },
  }
}

/** 供其它命令复用的迁移目录常量。 */
export const DB_MIGRATIONS_FOLDER = MIGRATIONS_FOLDER
