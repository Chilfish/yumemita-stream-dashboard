import { createRequire } from 'node:module'
import { neon, neonConfig, Pool } from '@neondatabase/serverless'
import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http'
import { drizzle as drizzleServerless } from 'drizzle-orm/neon-serverless'
import * as schema from './schema'

function getNodeRequire(): (id: string) => unknown {
  // workerd 没有 import.meta.url，也就没有本地 TCP；必须走 HTTP 代理。
  const moduleUrl = import.meta.url
  if (!moduleUrl) {
    throw new Error('当前运行时无法直连本地 Postgres；workerd 请设置 NEON_HTTP_ENDPOINT 并运行 bun run dev:db:proxy')
  }
  return createRequire(moduleUrl) as (id: string) => unknown
}

/**
 * 本地开发用 `pg` 直连（Bun/Node），Neon / Cloudflare 环境继续走 HTTP + WebSocket。
 * `endpoint` 指向本地 Neon HTTP 代理时（workerd 无法直连 TCP），强制走 HTTP 驱动。
 */
export function isLocalDatabaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  }
  catch {
    return false
  }
}

function createHttpDb(url: string, endpoint?: string) {
  if (endpoint) neonConfig.fetchEndpoint = endpoint
  return drizzleHttp({ client: neon(url), schema })
}

/** 只读查询连接：Neon HTTP 驱动；本地脚本可直连 `pg`。Worker 与脚本共用。 */
export function createDb(url: string, endpoint?: string) {
  if (!url) {
    throw new Error('DATABASE_URL 未配置')
  }

  if (!endpoint && isLocalDatabaseUrl(url)) {
    const requireNode = getNodeRequire()
    const { drizzle } = requireNode('drizzle-orm/node-postgres') as typeof import('drizzle-orm/node-postgres')
    const { Pool: NodePool } = requireNode('pg') as typeof import('pg')
    return drizzle({
      client: new NodePool({ connectionString: url }),
      schema,
    }) as unknown as ReturnType<typeof drizzleHttp>
  }

  return createHttpDb(url, endpoint)
}

/**
 * 写入 / 事务连接：Neon WebSocket Pool；本地 Postgres 自动切到 `pg` Pool。
 * ingest 不放进 Worker；只在 Bun 或 Node 里跑。
 */
export function createWriteDb(url: string) {
  if (!url) {
    throw new Error('DATABASE_URL 未配置')
  }

  if (isLocalDatabaseUrl(url)) {
    const requireNode = getNodeRequire()
    const { drizzle } = requireNode('drizzle-orm/node-postgres') as typeof import('drizzle-orm/node-postgres')
    const { Pool: NodePool } = requireNode('pg') as typeof import('pg')
    const pool = new NodePool({ connectionString: url })
    return {
      db: drizzle({ client: pool, schema }) as unknown as ReturnType<typeof drizzleServerless>,
      pool: pool as unknown as Pool,
    }
  }

  const pool = new Pool({ connectionString: url })
  return {
    db: drizzleServerless({ client: pool, schema }),
    pool,
  }
}

export type Db = ReturnType<typeof createDb>
export type WriteDb = ReturnType<typeof createWriteDb>['db']
