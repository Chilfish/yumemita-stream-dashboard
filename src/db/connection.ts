import { neon, Pool } from '@neondatabase/serverless'
import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http'
import { drizzle as drizzleServerless } from 'drizzle-orm/neon-serverless'
import * as schema from './schema'

/** 只读查询连接：Neon HTTP 驱动，Worker 与本地脚本共用。 */
export function createDb(url: string) {
  if (!url) {
    throw new Error('DATABASE_URL 未配置')
  }
  return drizzleHttp({ client: neon(url), schema })
}

/**
 * 写入 / 事务连接：Neon WebSocket Pool。
 * ingest 不放进 Worker；只在 Bun 或 Node 里跑。Node 需要 `ws`，Bun 自带 WebSocket。
 */
export function createWriteDb(url: string) {
  if (!url) {
    throw new Error('DATABASE_URL 未配置')
  }
  const pool = new Pool({ connectionString: url })
  return {
    db: drizzleServerless({ client: pool, schema }),
    pool,
  }
}

export type Db = ReturnType<typeof createDb>
export type WriteDb = ReturnType<typeof createWriteDb>['db']
