import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { Client } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

const DEFAULT_URL = 'postgres://postgres@localhost:5432/ymmt_dev'

export interface DevDbOptions {
  url: string
}

function parseArgs(argv: string[]): DevDbOptions {
  let url = DEFAULT_URL
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--url') url = argv[++index] ?? url
  }
  return { url }
}

async function ensureDatabase(url: string): Promise<void> {
  const parsed = new URL(url)
  const database = parsed.pathname.replace(/^\//, '')
  if (!/^[a-z0-9_]+$/.test(database)) {
    throw new Error(`数据库名不合法：${database}`)
  }

  const admin = new URL(url)
  admin.pathname = '/postgres'
  const client = new Client({ connectionString: admin.toString() })

  await client.connect()
  try {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [database])
    if (rowCount) {
      console.log(`[dev-db] 数据库已存在：${database}`)
      return
    }
    // 标识符不能参数化；database 已用白名单校验。
    await client.query(`create database "${database}"`)
    console.log(`[dev-db] 已创建数据库：${database}`)
  }
  finally {
    await client.end()
  }
}

function writeEnvLocal(url: string): void {
  const path = resolve('.env.local')
  if (existsSync(path)) {
    console.log('[dev-db] .env.local 已存在，未覆盖')
    return
  }
  writeFileSync(path, `# 本地开发数据库；不要提交（.gitignore 已忽略）\nDATABASE_URL=${url}\n`)
  console.log('[dev-db] 已写入 .env.local')
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  writeEnvLocal(options.url)
  await ensureDatabase(options.url)

  const pool = new (await import('pg')).Pool({ connectionString: options.url })
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: 'drizzle' })
    console.log('[dev-db] 迁移完成')
  }
  finally {
    await pool.end()
  }

  console.log(`
下一步：
  1. 启动本地 Postgres：pg_ctl start -l "$env:TEMP\\pg.log"
  2. 启动开发服务器：bun run dev
  3. 灌入本地数据：bun run dev:seed            # 全部 dataset，首次较慢
                       bun run dev:seed --dataset nonoka
`)
}

await main()
