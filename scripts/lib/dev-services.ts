import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { Client, Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { ensureSiloRunning } from './dev-silo.ts'
import {
  DEFAULT_LOCAL_DATABASE_URL,
  DEFAULT_LOCAL_PROXY_ENDPOINT,
  isLocalMode,
  isLocalUrl,
} from './local-config.ts'

/**
 * `bun run dev` 的本地服务编排：Postgres、开发库 / 迁移、Neon HTTP 代理。
 *
 * - Postgres 与代理都不由 dev 进程托管；Astro 退出或被 kill 后它们继续后台运行。
 * - 代理按需拉起一次，之后重复执行 dev 只复用健康检查通过的实例。
 */

export const DEFAULT_DATABASE_URL = DEFAULT_LOCAL_DATABASE_URL
export const DEFAULT_PROXY_ENDPOINT = DEFAULT_LOCAL_PROXY_ENDPOINT

export interface DevServicesResult {
  local: boolean
  databaseUrl: string
  endpoint: string
}

interface PostgresInstall {
  pgCtl: string
  dataDir: string
}

interface ProxyHealth {
  ok: boolean
  pid?: number
  host?: string
  database?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms))
}

function commandOutput(command: string, args: string[]): string | undefined {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
  })
  if (result.status !== 0) return undefined
  return result.stdout.trim()
}

function listDir(path: string): string[] {
  try {
    return readdirSync(path).map(name => join(path, name))
  }
  catch {
    return []
  }
}

function firstExisting(paths: (string | undefined)[]): string | undefined {
  return paths.find(path => path !== undefined && existsSync(path))
}

function findBinary(dirs: (string | undefined)[], names: string[]): string | undefined {
  const paths = dirs.flatMap(dir => (dir ? names.map(name => join(dir, name)) : []))
  return firstExisting(paths)
}

function resolveScoopPrefix(): string | undefined {
  if (process.platform !== 'win32') return undefined
  const fromCli = commandOutput('scoop', ['prefix', 'postgresql'])
  if (fromCli && existsSync(fromCli)) return fromCli
  return undefined
}

function resolvePostgresInstall(): PostgresInstall | undefined {
  if (process.platform === 'win32') {
    const scoopPrefix = resolveScoopPrefix()
    const programDirs = listDir(join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PostgreSQL'))
      .sort()
      .reverse()

    const fromWhere = commandOutput('where', ['pg_ctl'])?.split(/\r?\n/)[0]?.trim()
    const pgCtl = firstExisting([
      process.env.PG_CTL,
      fromWhere,
      scoopPrefix && join(scoopPrefix, 'bin', 'pg_ctl.exe'),
      process.env.SCOOP && join(process.env.SCOOP, 'apps', 'postgresql', 'current', 'bin', 'pg_ctl.exe'),
      join(process.env.USERPROFILE ?? '', 'scoop', 'apps', 'postgresql', 'current', 'bin', 'pg_ctl.exe'),
      join('C:\\', 'Scoop', 'apps', 'postgresql', 'current', 'bin', 'pg_ctl.exe'),
      ...programDirs.map(dir => join(dir, 'bin', 'pg_ctl.exe')),
    ])

    if (!pgCtl) return undefined

    const dataDir = firstExisting([
      process.env.PGDATA,
      scoopPrefix && join(scoopPrefix, 'data'),
      process.env.SCOOP && join(process.env.SCOOP, 'persist', 'postgresql', 'data'),
      join(process.env.USERPROFILE ?? '', 'scoop', 'persist', 'postgresql', 'data'),
      join('C:\\', 'Scoop', 'persist', 'postgresql', 'data'),
      ...programDirs.map(dir => join(dir, 'data')),
    ])

    return dataDir ? { pgCtl, dataDir } : undefined
  }

  const pgConfigBindir = commandOutput('pg_config', ['--bindir'])
  const versionedBins = [
    ...listDir('/usr/lib/postgresql').map(dir => join(dir, 'bin')),
    ...listDir('/opt/homebrew/opt').filter(dir => /postgresql/.test(dir)).map(dir => join(dir, 'bin')),
    ...listDir('/usr/local/opt').filter(dir => /postgresql/.test(dir)).map(dir => join(dir, 'bin')),
  ]
  const fromPath = commandOutput('which', ['pg_ctl'])

  const pgCtl = firstExisting([
    process.env.PG_CTL,
    fromPath,
    pgConfigBindir && join(pgConfigBindir, 'pg_ctl'),
    findBinary(versionedBins, ['pg_ctl']),
  ])
  if (!pgCtl) return undefined

  const dataDir = firstExisting([
    process.env.PGDATA,
    ...listDir('/opt/homebrew/var').filter(dir => /postgres/.test(dir)),
    ...listDir('/usr/local/var').filter(dir => /postgres/.test(dir)),
    ...listDir('/var/lib/postgresql').map(dir => join(dir, 'main')),
  ])

  return dataDir ? { pgCtl, dataDir } : undefined
}

async function isPortOpen(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return await new Promise((resolvePort) => {
    const socket = connect({ host, port })
    const finish = (open: boolean) => {
      socket.destroy()
      resolvePort(open)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function logPath(name: string): string {
  const path = resolve('temp', name)
  mkdirSync(dirname(path), { recursive: true })
  return path
}

export function ensurePostgresRunning(databaseUrl: string): void {
  const install = resolvePostgresInstall()
  if (!install) {
    const parsed = new URL(databaseUrl)
    throw new Error(
      `未找到 pg_ctl（或数据目录）。请安装 PostgreSQL，并设置 PGDATA 指向数据目录；端口 ${parsed.port || 5432}。见 docs/engineering/local-database.md`,
    )
  }

  const status = spawnSync(install.pgCtl, ['status', '-D', install.dataDir], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (status.status === 0) {
    console.log(`[dev] Postgres 已在运行（${install.dataDir}）`)
    return
  }
  if (status.status === 4) {
    throw new Error(`Postgres 数据目录不可用：${install.dataDir}（${status.stderr?.trim() || status.stdout?.trim()}）`)
  }

  const log = logPath('postgres.log')
  console.log(`[dev] 启动 Postgres（${install.dataDir}）…`)
  // stdio 必须 ignore：postmaster 会继承 pg_ctl 的管道，Bun 的 spawnSync 会一直等 EOF。
  const start = spawnSync(
    install.pgCtl,
    ['start', '-D', install.dataDir, '-l', log, '-w', '-t', '60'],
    { stdio: 'ignore', windowsHide: true },
  )
  if (start.status !== 0) {
    const tail = readLogTail(log)
    throw new Error(`Postgres 启动失败（退出码 ${start.status ?? 'signal'}，日志 ${log}）${tail ? `：\n${tail}` : ''}`)
  }
}

export async function ensureDevDatabase(databaseUrl: string): Promise<void> {
  const database = new URL(databaseUrl).pathname.replace(/^\//, '')
  if (!/^[a-z0-9_]+$/.test(database)) {
    throw new Error(`数据库名不合法：${database}`)
  }

  const admin = new URL(databaseUrl)
  admin.pathname = '/postgres'
  const client = new Client({ connectionString: admin.toString() })

  await client.connect()
  try {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [database])
    if (!rowCount) {
      // 标识符不能参数化；database 已用白名单校验。
      await client.query(`create database "${database}"`)
      console.log(`[dev] 已创建数据库：${database}`)
    }
  }
  finally {
    await client.end()
  }
}

export async function applyMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: 'drizzle' })
  }
  finally {
    await pool.end()
  }
}

/** 覆盖已有 key、保留其他行（包括 `*_ONLINE` 的线上目标）；用于把 `.dev.vars` 切到本机。 */
function upsertEnvValues(content: string, values: Record<string, string>): string {
  const pending = new Map(Object.entries(values))
  const lines = content.length > 0 ? content.split(/\r?\n/) : []
  const result = lines.map((line) => {
    const match = /^\s*([A-Za-z0-9_]+)\s*=/.exec(line)
    if (!match) return line
    const key = match[1] as string
    if (!pending.has(key)) return line
    const value = pending.get(key) as string
    pending.delete(key)
    return `${key}=${value}`
  })
  for (const [key, value] of pending) result.push(`${key}=${value}`)
  return `${result.join('\n').replace(/\n+$/, '')}\n`
}

export function ensureDevVars(databaseUrl: string, endpoint: string): void {
  const path = resolve('.dev.vars')
  const values: Record<string, string> = {
    DATABASE_URL: databaseUrl,
    NEON_HTTP_ENDPOINT: endpoint,
  }
  if (isLocalMode()) {
    values.LOCAL = '1'
  }

  if (!existsSync(path)) {
    writeFileSync(
      path,
      `# workerd 本地开发变量；不要提交（.gitignore 已忽略）\n${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`,
    )
    console.log('[dev] 已写入 .dev.vars')
    return
  }

  const content = readFileSync(path, 'utf8')
  if (isLocalMode()) {
    const next = upsertEnvValues(content, values)
    if (next !== content) {
      writeFileSync(path, next)
      console.log(`[dev] .dev.vars 已切到本地：${Object.keys(values).join(' / ')}`)
    }
    return
  }

  const missing = Object.entries(values).filter(([key]) => readEnvValue(content, key) === undefined)
  if (missing.length) {
    const prefix = content.endsWith('\n') ? content : `${content}\n`
    writeFileSync(path, `${prefix}${missing.map(([key, value]) => `${key}=${value}`).join('\n')}\n`)
    console.log(`[dev] .dev.vars 已补充：${missing.map(([key]) => key).join(' / ')}`)
  }

  const configured = readEnvValue(content, 'DATABASE_URL')
  if (configured && !isLocalUrl(configured)) {
    console.warn(`[dev] 注意：.dev.vars 的 DATABASE_URL 不是本机地址（${new URL(configured).host}），astro dev 仍会连远程库`)
  }
}

async function getProxyHealth(endpoint: string): Promise<ProxyHealth | undefined> {
  try {
    const response = await fetch(new URL('/health', endpoint), { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return undefined
    return await response.json() as ProxyHealth
  }
  catch {
    return undefined
  }
}

function readLogTail(path: string, lines = 10): string {
  if (!existsSync(path)) return ''
  const content = readFileSync(path, 'utf8').trimEnd().split(/\r?\n/)
  return content.slice(-lines).join('\n')
}

export async function ensureDevProxy(endpoint: string, databaseUrl: string): Promise<void> {
  if (!isLocalUrl(endpoint)) {
    console.log(`[dev] NEON_HTTP_ENDPOINT 不是本机地址，跳过开发代理：${endpoint}`)
    return
  }

  const database = new URL(databaseUrl).pathname.slice(1)
  const host = new URL(databaseUrl).host
  const health = await getProxyHealth(endpoint)
  if (health?.ok) {
    if (health.database === database && health.host === host) {
      console.log(`[dev] 复用已运行的代理（pid ${health.pid ?? '?'}，${health.database}）`)
      return
    }
    throw new Error(
      `端口已被另一个开发代理占用：pid ${health.pid ?? '?'} 连着 ${health.host ?? '?'}/${health.database ?? '?'}，`
      + `当前需要 ${host}/${database}。请先结束该进程，或改 DEV_DB_PROXY_PORT 与 .dev.vars 的 NEON_HTTP_ENDPOINT。`,
    )
  }

  const log = logPath('dev-db-proxy.log')
  const fd = openSync(log, 'a')
  const port = new URL(endpoint).port || '4444'
  const script = resolve('scripts/dev-db-proxy.ts')
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DEV_DB_PROXY_PORT: port,
  }

  if (process.platform === 'win32') {
    // `start` 让代理脱离父进程树：taskkill /T、关闭终端都不会带走它。
    const child = spawn('cmd.exe', ['/c', 'start', '', '/b', process.execPath, script], {
      cwd: process.cwd(),
      detached: true,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
      env,
    })
    child.unref()
  }
  else {
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      detached: true,
      stdio: ['ignore', fd, fd],
      env,
    })
    child.unref()
  }
  console.log(`[dev] 启动开发代理（日志 temp/dev-db-proxy.log）`)

  for (let attempt = 0; attempt < 50; attempt += 1) {
    await sleep(200)
    const started = await getProxyHealth(endpoint)
    if (started?.ok) {
      console.log(`[dev] 代理就绪（pid ${started.pid ?? '?'}）：${endpoint} -> ${started.host ?? host}/${started.database ?? database}`)
      return
    }
  }

  const tail = readLogTail(log)
  throw new Error(`开发代理启动失败（${endpoint}）${tail ? `：\n${tail}` : '，见 temp/dev-db-proxy.log'}`)
}

export async function ensureDevServices(
  options: { url?: string, endpoint?: string } = {},
): Promise<DevServicesResult> {
  const local = isLocalMode()
  const databaseUrl = options.url
    || (local ? DEFAULT_DATABASE_URL : process.env.DATABASE_URL)
    || DEFAULT_DATABASE_URL
  const endpoint = options.endpoint
    || (local ? DEFAULT_PROXY_ENDPOINT : process.env.NEON_HTTP_ENDPOINT)
    || DEFAULT_PROXY_ENDPOINT

  if (!isLocalUrl(databaseUrl)) {
    console.warn(
      `[dev] DATABASE_URL 不是本机地址（${new URL(databaseUrl).host}），跳过本地 Postgres；`
      + 'astro dev 将直接使用远程库。想走本地库请把 .dev.vars 的 DATABASE_URL 指回 localhost。',
    )
    return { local: false, databaseUrl, endpoint }
  }

  ensurePostgresRunning(databaseUrl)
  await ensureDevDatabase(databaseUrl)
  await applyMigrations(databaseUrl)
  ensureDevVars(databaseUrl, endpoint)

  const parsed = new URL(databaseUrl)
  const port = Number(parsed.port || 5432)
  if (!(await isPortOpen(parsed.hostname, port))) {
    throw new Error(`Postgres 已启动但 ${parsed.hostname}:${port} 不可连接；检查 pg_hba.conf 与监听地址`)
  }

  await ensureDevProxy(endpoint, databaseUrl)

  try {
    const silo = await ensureSiloRunning()
    if (!silo.started) {
      console.warn(`[dev] LOCAL=1 但本地对象存储未启动：${silo.reason}`)
      console.warn('[dev] 页面读库不受影响；publish / fetch 的上传会失败。装好 SILO 后重跑本命令。')
    }
  }
  catch (error) {
    console.warn(`[dev] 本地对象存储启动失败：${error instanceof Error ? error.message : String(error)}`)
  }

  return { local: true, databaseUrl, endpoint }
}
