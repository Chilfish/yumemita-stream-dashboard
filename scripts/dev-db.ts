import process from 'node:process'
import {
  applyMigrations,
  DEFAULT_DATABASE_URL,
  ensureDevDatabase,
  ensureDevVars,
  ensureEnvLocal,
  ensurePostgresRunning,
} from './lib/dev-services.ts'

export interface DevDbOptions {
  url: string
}

function parseArgs(argv: string[]): DevDbOptions {
  let url = DEFAULT_DATABASE_URL
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--url') url = argv[++index] ?? url
  }
  return { url }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  ensurePostgresRunning(options.url)
  ensureEnvLocal(options.url)
  await ensureDevDatabase(options.url)
  await applyMigrations(options.url)
  ensureDevVars(options.url, process.env.NEON_HTTP_ENDPOINT ?? 'http://127.0.0.1:4444/sql')
  console.log('[dev-db] 数据库与迁移就绪')

  console.log(`
下一步：
  1. 启动开发服务器：bun run dev    # 自动拉起 Postgres 与开发代理
  2. 灌入本地数据：bun run dev:seed            # 全部 dataset，首次较慢
                     bun run dev:seed --dataset nonoka
`)
}

await main()
