/**
 * 本地开发代理：把 Neon 的 HTTP 查询协议转发到本机 Postgres。
 *
 * workerd（astro dev / preview）不能直连 TCP，`@neondatabase/serverless` 的
 * HTTP 驱动又只会说 Neon 的 `/sql` 协议，所以这里做一个最小实现。
 * 只接受本机数据库地址，避免误把线上库暴露到 localhost。
 */
import process from 'node:process'
import { Option } from 'commander'
import { Pool } from 'pg'
import { isLocalDatabaseUrl } from '@/db/connection.ts'
import type { CommandSpec } from '@scripts/lib/cli/runtime.ts'
import { CliError, ConfigError } from '@scripts/lib/cli/exit.ts'
import { createLogger, type Logger } from '@scripts/lib/cli/logger.ts'

export interface DevProxyOptions {
  /** 覆盖 `DEV_DB_PROXY_PORT`。 */
  port?: number
  /** 全局 --dry-run：只报告将要监听的地址与目标库，不起服务。 */
  dryRun?: boolean
  log?: Logger
}

export interface DevProxyData {
  port: number
  databaseUrl: string
  host: string
  database: string
  listening: boolean
}

export interface DevProxyResult {
  exitCode: number
  data: DevProxyData
}

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

/**
 * 业务主体：校验 `DATABASE_URL` 是本机地址后启动代理。
 *
 * 服务不随命令返回而结束（和原来一样是前台进程）：`/health` 返回状态，`POST /sql` 执行查询。
 */
export async function runDevProxy(options: DevProxyOptions): Promise<DevProxyResult> {
  const log = options.log ?? createLogger({ name: 'dev.proxy' })
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new ConfigError('缺少环境变量 DATABASE_URL', {
      code: 'MISSING_ENV',
      hint: '在 .dev.vars 里配置 DATABASE_URL（本机地址），或先运行 bun run ymmt dev db',
      context: { name: 'DATABASE_URL' },
    })
  }
  if (!isLocalDatabaseUrl(databaseUrl)) {
    throw new CliError(`dev-db-proxy 只接受本地数据库地址，当前是 ${databaseUrl}`, {
      code: 'NON_LOCAL_DATABASE',
      hint: '把 .dev.vars 的 DATABASE_URL 指回 localhost，或先运行 bun run ymmt dev db',
      context: { databaseUrl },
    })
  }

  const port = options.port ?? Number(process.env.DEV_DB_PROXY_PORT ?? 4444)
  const target = new URL(databaseUrl)
  const database = target.pathname.slice(1)
  const data: DevProxyData = {
    port,
    databaseUrl,
    host: target.host,
    database,
    listening: false,
  }

  if (options.dryRun) {
    log.info(`dry-run：将在 http://127.0.0.1:${port}/sql 转发到 ${target.host}/${database}，不启动服务`)
    return { exitCode: 0, data }
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    // 返回原始文本，交给 Neon 驱动按 dataTypeID 解析。
    types: { getTypeParser: () => (value: string) => value },
  })

  let queryCount = 0
  let requestCount = 0

  const runQuery = async (request: QueryRequest): Promise<QueryResult> => {
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

  data.port = server.port ?? port
  data.listening = true
  log.info(`http://127.0.0.1:${data.port}/sql -> ${target.host}${target.pathname}`)

  return { exitCode: 0, data }
}

export const devProxySpec: CommandSpec = {
  id: 'dev.proxy',
  description: '前台启动 Neon HTTP 兼容代理，把 /sql 转发到本机 Postgres',
  details: 'workerd 不能直连 TCP，astro dev / preview 需要它。只接受本机 `DATABASE_URL`，\n'
    + '避免误把线上库暴露到 localhost。服务在前台运行，Ctrl-C 结束。\n'
    + '`bun run ymmt dev` 会按需自动拉起同一个代理，平时不需要单独跑。',
  examples: [
    'bun run ymmt dev proxy',
    'bun run ymmt dev proxy --port 4444',
  ],
  options: [new Option('--port <n>', '监听端口，默认 DEV_DB_PROXY_PORT 或 4444')],
  async run(ctx) {
    const port = ctx.options.port === undefined ? undefined : ctx.integer('port', 4444, 1)
    const result = await runDevProxy({ port, dryRun: ctx.dryRun, log: ctx.log })
    return { exitCode: result.exitCode, data: result.data }
  },
}
