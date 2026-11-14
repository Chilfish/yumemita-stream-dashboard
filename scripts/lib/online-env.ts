/**
 * 线上目标（Neon + R2）的环境切换。
 *
 * `.dev.vars` 里普通键是本地值，`*_ONLINE` 是线上目标。本模块负责：
 * - 校验线上数据库不是本机地址、R2 凭据齐全；
 * - 把 `*_ONLINE` 展开成同名键，并把进程切成 `LOCAL=0`；
 * - 返回恢复函数。调用方（`publish sync` / `data refetch`）可能同进程继续跑本地任务，
 *   不能把线上环境漏给后续步骤。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CliError } from './cli/exit.ts'
import { readEnvFile } from './env.ts'
import { isLocalUrl } from './local-config.ts'

export interface OnlineTarget {
  /** `.dev.vars` 的原始键值。 */
  remote: Record<string, string>
  databaseUrl: string
  bucket: string
}

/** 读取并校验 `.dev.vars` 的线上目标；失败时抛 `CliError`。 */
export function readOnlineTarget(appRoot: string): OnlineTarget {
  const envPath = join(appRoot, '.dev.vars')
  if (!existsSync(envPath)) {
    throw new CliError('找不到 .dev.vars（线上凭据）；只认它，不读环境变量里的本机值', {
      hint: '从 .dev.vars.example 复制一份，填上 DATABASE_URL_ONLINE 与 R2_*',
    })
  }

  const remote = readEnvFile(envPath)
  const databaseUrl = remote.DATABASE_URL_ONLINE
  if (!databaseUrl) {
    throw new CliError('.dev.vars 缺少 DATABASE_URL_ONLINE（线上 Neon）', {
      hint: '在 .dev.vars 里加 DATABASE_URL_ONLINE=postgres://…（线上库）',
    })
  }
  if (isLocalUrl(databaseUrl)) {
    throw new CliError(`DATABASE_URL_ONLINE 指向本机（${new URL(databaseUrl).host}），拒绝同步`, {
      hint: '把 DATABASE_URL_ONLINE 改成线上 Neon 地址；本地数据用 bun run ymmt db ingest',
    })
  }

  const missingEnv = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']
    .filter(key => !remote[key])
  if (missingEnv.length > 0) {
    throw new CliError(`.dev.vars 缺少 ${missingEnv.join(' / ')}`, {
      hint: '在 .dev.vars 里补齐 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET',
    })
  }

  const bucket = `${remote.R2_BUCKET}${remote.R2_PREFIX ? `/${remote.R2_PREFIX}` : ''}`
  return { remote, databaseUrl, bucket }
}

/**
 * 把进程切到线上目标：`*_ONLINE` 展开成同名键，并清掉本地端点，
 * 避免任何模块回落到本机服务。返回恢复函数。
 */
export function applyOnlineEnv(remote: Record<string, string>): () => void {
  const saved = new Map<string, string | undefined>()
  const setKey = (key: string, value: string | undefined): void => {
    if (!saved.has(key)) saved.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  for (const [key, value] of Object.entries(remote)) {
    if (key === 'LOCAL')
      continue
    if (key.endsWith('_ONLINE'))
      setKey(key.slice(0, -'_ONLINE'.length), value)
    else if (key !== 'DATABASE_URL')
      setKey(key, value)
  }
  setKey('LOCAL', '0')
  for (const key of [
    'DATABASE_URL_ONLINE',
    'NEON_HTTP_ENDPOINT',
    'S3_ENDPOINT',
    'MINIO_ENDPOINT',
    'SILO_BIN',
    'SILO_DATA',
    'MINIO_ROOT_USER',
    'MINIO_ROOT_PASSWORD',
  ]) {
    setKey(key, undefined)
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
