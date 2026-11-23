/**
 * 线上目标：从 `<env.file>.prod` 读部署用的值，并临时把当前进程切到线上。
 *
 * devkit 0.2.0 起环境按文件分层（base + `.dev.vars.dev` / `.dev.vars.prod`），不再有
 * `*_ONLINE` 后缀与 `applyOnlineEnv` / `readOnlineTarget`。`publish sync` / `data refetch`
 * / `data official` 仍需要「只读线上、执行期间强制 LOCAL=0」这一能力，所以在这里补一份
 * 基于新分层的实现。
 *
 * 只信任文件里的线上值：本地 `.dev.vars` 里的 `DATABASE_URL` 是本机地址，不能被当成目标。
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { type DevkitConfig } from '@chilfish/devkit'
import { ConfigError } from '@chilfish/devkit/cli'
import { readEnvFile } from '@chilfish/devkit/env'
import { isLocalUrl } from '@chilfish/devkit/shared'

export interface OnlineTarget {
  /** base 与 prod 合并后的值（prod 优先），用于构造对象存储凭据。 */
  remote: Record<string, string>
  /** 线上数据库地址；来自 prod 文件，缺省时退回进程环境里的非本机值。 */
  databaseUrl: string
  /** 线上桶名，`R2_BUCKET`。 */
  bucket: string
  /** prod 文件路径，报错时带出来。 */
  prodFile: string
}

export interface ReadOnlineTargetOptions {
  config: DevkitConfig
  /** 仓库根目录，默认当前工作目录。 */
  cwd?: string
}

const LOCAL_ONLY_KEYS = [
  'NEON_HTTP_ENDPOINT',
  'S3_ENDPOINT',
  'MINIO_ENDPOINT',
  'MINIO_ROOT_USER',
  'MINIO_ROOT_PASSWORD',
  'SILO_BIN',
  'SILO_DATA',
]

/**
 * 读线上目标。
 *
 * 合并顺序：base 文件 < `.dev.vars.prod`；`DATABASE_URL` 只认 prod 文件，或进程环境里
 * 明确给出的非本机地址。缺失、仍指向本机都直接抛配置错误（退出码 3）。
 */
export function readOnlineTarget(options: ReadOnlineTargetOptions): OnlineTarget {
  const { config } = options
  const cwd = options.cwd ?? process.cwd()
  const baseFile = resolve(cwd, config.env.file)
  const prodFile = `${baseFile}.prod`

  const base = existsSync(baseFile) ? readEnvFile(baseFile) : {}
  const prod = existsSync(prodFile) ? readEnvFile(prodFile) : {}
  const remote: Record<string, string> = { ...base, ...prod }

  const fromFile = prod.DATABASE_URL
  const fromProcess = process.env.DATABASE_URL
  const databaseUrl = fromFile ?? (isLocalUrl(fromProcess) ? undefined : fromProcess)

  if (!databaseUrl) {
    throw new ConfigError(`找不到线上数据库地址：${config.env.file}.prod 里没有 DATABASE_URL`, {
      code: 'MISSING_ENV',
      hint: `把线上的 DATABASE_URL 写进 ${config.env.file}.prod（该文件不进 git）`,
      context: { prodFile },
    })
  }
  if (isLocalUrl(databaseUrl)) {
    throw new ConfigError(`${config.env.file}.prod 的 DATABASE_URL 指向本机（${databaseUrl}）`, {
      code: 'NON_LOCAL_DATABASE',
      hint: '线上目标必须是 Neon 地址；本机开发用 LOCAL=1 与 .dev.vars',
      context: { prodFile, databaseUrl },
    })
  }

  return {
    remote,
    databaseUrl,
    bucket: remote.R2_BUCKET ?? '',
    prodFile,
  }
}

export interface ApplyOnlineEnvOptions {
  config: DevkitConfig
  target: OnlineTarget
}

/**
 * 把当前进程切到线上目标，返回恢复函数。
 *
 * 设置 prod / base 的值（`DATABASE_URL` 用校验过的线上地址），强制 `LOCAL=0`，并清掉
 * 只存在于本机的端点，避免任何模块回退到本机代理或 SILO。`LOCAL` 始终以线上为准。
 */
export function applyOnlineEnv(options: ApplyOnlineEnvOptions): () => void {
  const { config, target } = options
  const saved = new Map<string, string | undefined>()

  const set = (key: string, value: string | undefined): void => {
    if (!saved.has(key))
      saved.set(key, process.env[key])
    if (value === undefined)
      delete process.env[key]
    else process.env[key] = value
  }

  for (const [key, value] of Object.entries(target.remote)) {
    if (key === config.env.localFlag || key === 'DATABASE_URL')
      continue
    set(key, value)
  }
  set('DATABASE_URL', target.databaseUrl)
  set(config.env.localFlag, '0')
  for (const key of LOCAL_ONLY_KEYS)
    set(key, undefined)

  return () => {
    for (const [key, value] of saved) {
      if (value === undefined)
        delete process.env[key]
      else process.env[key] = value
    }
  }
}

export interface ApplyProdEnvOptions {
  config: DevkitConfig
  /** 仓库根目录，默认当前工作目录。 */
  cwd?: string
}

export interface ApplyProdEnvResult {
  /** 是否读到了 `.dev.vars.prod`。 */
  prodFile: boolean
  /** 切换后 `DATABASE_URL` 是否仍指向本机（线上地址缺失时）。 */
  databaseLocal: boolean
}

/**
 * 强制把进程切到线上文件：`LOCAL=0`，用 base + `.dev.vars.prod` 覆盖进程环境。
 *
 * `loadEnvFile` 只补缺失的键，所以在「CLI 已按本地模式加载过」的进程里再调用它，
 * 本机 `DATABASE_URL` / `PUBLIC_R2_BASE` 会残留。部署这类必须在同一进程内切到线上的
 * 场景改用本函数：文件里的值直接覆盖进程环境。
 *
 * 没有文件时（CI 直接注入变量）保持进程环境不动，只认里面已有的线上值。
 */
export function applyProdEnv(options: ApplyProdEnvOptions): ApplyProdEnvResult {
  const { config } = options
  const cwd = options.cwd ?? process.cwd()
  const baseFile = resolve(cwd, config.env.file)
  const prodFile = `${baseFile}.prod`

  const base = existsSync(baseFile) ? readEnvFile(baseFile) : {}
  const hasProd = existsSync(prodFile)
  const prod = hasProd ? readEnvFile(prodFile) : {}

  for (const [key, value] of Object.entries({ ...base, ...prod })) {
    if (key === config.env.localFlag)
      continue
    process.env[key] = value
  }
  process.env[config.env.localFlag] = '0'
  for (const key of LOCAL_ONLY_KEYS)
    delete process.env[key]

  return {
    prodFile: hasProd,
    databaseLocal: isLocalUrl(process.env.DATABASE_URL),
  }
}
