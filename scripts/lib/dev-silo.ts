import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { AwsClient } from 'aws4fetch'
import {
  DEFAULT_LOCAL_ACCESS_KEY,
  DEFAULT_LOCAL_ENDPOINT,
  DEFAULT_LOCAL_SECRET_KEY,
  isLocalMode,
  isLocalUrl,
  localEndpoint,
} from './local-config.ts'
import { readCredentials, type Credentials } from './object-storage.ts'

/**
 * `LOCAL=1` 时的本地对象存储编排（SILO）。
 *
 * SILO 是 MinIO 的维护分支，保持 S3 API、`silo server` 命令与 `MINIO_*` 环境变量契约；
 * 健康检查仍是 `/minio/health/live`。与 Postgres / 代理一样是独立后台进程，
 * Astro 退出后继续运行。启动后创建桶并设为匿名只读，浏览器才能直接取封面 / 表情。
 *
 * 没装 SILO 不阻塞开发：返回 `started: false` 与原因，由调用方决定提示还是失败。
 */

const DEFAULT_DATA_DIR = 'temp/silo-data'

export interface SiloResult {
  started: boolean
  endpoint: string
  /** 没有启动时的原因（未装 / 健康检查失败）。 */
  reason?: string
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

export function findSiloBinary(): string | undefined {
  const fromWhere = (name: string): string | undefined => (process.platform === 'win32'
    ? commandOutput('where', [name])?.split(/\r?\n/)[0]?.trim()
    : commandOutput('which', [name]))

  const candidates = [
    process.env.SILO_BIN,
    fromWhere('silo'),
    // 兼容已经装了 MinIO 的机器；SILO 的 CLI 与它一致。
    process.env.MINIO_BIN,
    fromWhere('minio'),
    process.platform === 'win32' && process.env.SCOOP && join(process.env.SCOOP, 'apps', 'silo', 'current', 'silo.exe'),
    process.platform === 'win32' && join(process.env.USERPROFILE ?? '', 'scoop', 'apps', 'silo', 'current', 'silo.exe'),
    process.platform === 'win32' && join('C:\\', 'Scoop', 'apps', 'silo', 'current', 'silo.exe'),
    process.platform !== 'win32' && '/usr/local/bin/silo',
    process.platform !== 'win32' && '/opt/homebrew/bin/silo',
  ]

  return candidates.find(path => path !== undefined && path !== false && existsSync(path)) as string | undefined
}

async function healthy(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/minio/health/live`, {
      signal: AbortSignal.timeout(1500),
    })
    return response.ok
  }
  catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms))
}

function logPath(): string {
  const path = resolve('temp', 'silo.log')
  mkdirSync(dirname(path), { recursive: true })
  return path
}

function readLogTail(path: string, lines = 10): string {
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf8').trimEnd().split(/\r?\n/).slice(-lines).join('\n')
}

function localCredentials(): Credentials {
  const credentials = readCredentials()
  if (!credentials) {
    throw new Error('LOCAL=1 但无法构造本地对象存储凭据')
  }
  return credentials
}

function signedFetch(credentials: Credentials, url: string, init: RequestInit): Promise<Response> {
  const client = new AwsClient({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    service: 's3',
    region: process.env.S3_REGION ?? 'us-east-1',
  })
  return client.fetch(url, init)
}

/** 创建桶并设为匿名只读；重复执行没有副作用。 */
export async function ensureLocalBucket(credentials: Credentials): Promise<void> {
  const base = `${credentials.endpoint}/${credentials.bucket}`
  const created = await signedFetch(credentials, base, { method: 'PUT' })
  if (!created.ok && created.status !== 409) {
    console.warn(`[dev] 创建本地桶失败（HTTP ${created.status}）：${await created.text().catch(() => '')}`)
    return
  }

  const policy = {
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: { AWS: ['*'] },
      Action: ['s3:GetObject'],
      Resource: [`arn:aws:s3:::${credentials.bucket}/*`],
    }],
  }
  const applied = await signedFetch(credentials, `${base}?policy`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(policy),
  })
  if (!applied.ok) {
    console.warn(`[dev] 设置本地桶匿名读失败（HTTP ${applied.status}）：浏览器取封面会 403`)
  }
}

export async function ensureSiloRunning(
  options: { endpoint?: string, dataDir?: string } = {},
): Promise<SiloResult> {
  if (!isLocalMode()) {
    return { started: false, endpoint: localEndpoint(), reason: 'LOCAL 未开启' }
  }

  const endpoint = (options.endpoint ?? localEndpoint() ?? DEFAULT_LOCAL_ENDPOINT).replace(/\/+$/, '')
  if (!isLocalUrl(endpoint)) {
    throw new Error(`LOCAL=1 时对象存储端点必须是本机地址：${endpoint}`)
  }

  if (await healthy(endpoint)) {
    console.log(`[dev] SILO 已在运行（${endpoint}）`)
    await ensureLocalBucket(localCredentials())
    return { started: true, endpoint }
  }

  const binary = findSiloBinary()
  if (!binary) {
    return {
      started: false,
      endpoint,
      reason: '未找到 silo 可执行文件（下载后加入 PATH，或用 SILO_BIN 指定路径）',
    }
  }

  const dataDir = resolve(options.dataDir ?? process.env.SILO_DATA ?? DEFAULT_DATA_DIR)
  mkdirSync(dataDir, { recursive: true })

  const parsed = new URL(endpoint)
  const port = parsed.port || '9000'
  const consolePort = process.env.SILO_CONSOLE_PORT ?? String(Number(port) + 1)
  const log = logPath()
  const fd = openSync(log, 'a')
  const env = {
    ...process.env,
    MINIO_ROOT_USER: process.env.S3_ACCESS_KEY_ID ?? process.env.MINIO_ROOT_USER ?? DEFAULT_LOCAL_ACCESS_KEY,
    MINIO_ROOT_PASSWORD: process.env.S3_SECRET_ACCESS_KEY ?? process.env.MINIO_ROOT_PASSWORD ?? DEFAULT_LOCAL_SECRET_KEY,
    MINIO_API_CORS_ALLOW_ORIGIN: process.env.MINIO_API_CORS_ALLOW_ORIGIN ?? '*',
  }
  const args = ['server', dataDir, '--address', `${parsed.hostname}:${port}`, '--console-address', `127.0.0.1:${consolePort}`]

  console.log(`[dev] 启动 SILO（${dataDir}）…`)
  const child = process.platform === 'win32'
    ? spawn('cmd.exe', ['/c', 'start', '', '/b', binary, ...args], {
        cwd: process.cwd(),
        detached: true,
        windowsHide: true,
        stdio: ['ignore', fd, fd],
        env,
      })
    : spawn(binary, args, {
        cwd: process.cwd(),
        detached: true,
        stdio: ['ignore', fd, fd],
        env,
      })
  child.unref()

  for (let attempt = 0; attempt < 50; attempt += 1) {
    await sleep(200)
    if (await healthy(endpoint)) {
      console.log(`[dev] SILO 就绪：${endpoint}（数据 ${dataDir}）`)
      await ensureLocalBucket(localCredentials())
      return { started: true, endpoint }
    }
  }

  const tail = readLogTail(log)
  throw new Error(`SILO 启动失败（${endpoint}）${tail ? `：\n${tail}` : '，见 temp/silo.log'}`)
}
