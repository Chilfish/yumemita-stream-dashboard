import process from 'node:process'
import { Pool } from 'pg'
import { isLocalDatabaseUrl } from '../src/db/connection.ts'
import { loadEnvFiles, requireEnv } from './lib/env.ts'

/**
 * 本地开发代理：把 Neon 的 HTTP 查询协议转发到本机 Postgres。
 *
 * workerd（astro dev / preview）不能直连 TCP，`@neondatabase/serverless` 的
 * HTTP 驱动又只会说 Neon 的 `/sql` 协议，所以这里做一个最小实现。
 * 只接受本机数据库地址，避免误把线上库暴露到 localhost。
 */

loadEnvFiles()

const databaseUrl = requireEnv('DATABASE_URL')
if (!isLocalDatabaseUrl(databaseUrl)) {
  throw new Error(`dev-db-proxy 只接受本地数据库地址，当前是 ${databaseUrl}`)
}

const port = Number(process.env.DEV_DB_PROXY_PORT ?? 4444)
const target = new URL(databaseUrl)

const pool = new Pool({
  connectionString: databaseUrl,
  // 返回原始文本，交给 Neon 驱动按 dataTypeID 解析。
  types: { getTypeParser: () => (value: string) => value },
})

interface QueryRequest {
  query: string
  params?: unknown[]
}

interface QueryResult {
  command: string | null
  rowCount: number | null
  fields: { name: string, dataTypeID: number }[]
  rows: unknown[][]
}

let queryCount = 0
let requestCount = 0

async function runQuery(request: QueryRequest): Promise<QueryResult> {
  queryCount += 1
  const result = await pool.query({
    text: request.query,
    values: (request.params ?? []) as unknown[],
    rowMode: 'array',
  })

  return {
    command: result.command,
    rowCount: result.rowCount,
    fields: result.fields.map(field => ({ name: field.name, dataTypeID: field.dataTypeID })),
    rows: result.rows as unknown[][],
  }
}

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        pid: process.pid,
        host: target.host,
        database: target.pathname.slice(1),
        queries: queryCount,
        requests: requestCount,
      })
    }
    if (request.method !== 'POST' || url.pathname !== '/sql') {
      return new Response('not found', { status: 404 })
    }

    requestCount += 1
    try {
      const body = await request.json() as QueryRequest & { queries?: QueryRequest[] }
      if (Array.isArray(body.queries)) {
        const results: QueryResult[] = []
        for (const query of body.queries) results.push(await runQuery(query))
        return Response.json({ results })
      }
      return Response.json(await runQuery(body))
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return Response.json({ message }, { status: 400 })
    }
  },
})

console.log(`[dev-db-proxy] http://127.0.0.1:${server.port}/sql -> ${new URL(databaseUrl).host}${new URL(databaseUrl).pathname}`)
