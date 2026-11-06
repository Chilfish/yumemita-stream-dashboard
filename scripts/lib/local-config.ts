/**
 * 本地模式的配置解析；不依赖 `bun` / S3 客户端，方便单测、脚本与 astro.config 共用。
 *
 * `LOCAL=1` 是总开关：数据库地址、对象存储端点、媒体公开地址都切到本机。
 * 对象存储默认走 SILO（MinIO 的维护分支），S3 API 与 `MINIO_*` 变量契约保持兼容。
 * `env` 参数让配置文件可以先合并 `.env*` 与进程环境再判断，避免各处自己解析。
 */
import { resolve } from 'node:path'
import { isLocalUrl } from '../../src/lib/local-url.ts'

export { isLocalUrl }

type Env = Record<string, string | undefined>

export const DEFAULT_LOCAL_DATABASE_URL = 'postgres://postgres@localhost:5432/ymmt_dev'
export const DEFAULT_LOCAL_PROXY_ENDPOINT = 'http://127.0.0.1:4444/sql'
export const DEFAULT_LOCAL_ENDPOINT = 'http://127.0.0.1:9000'
export const DEFAULT_LOCAL_BUCKET = 'yumemita-data'
export const DEFAULT_LOCAL_ACCESS_KEY = 'silo-admin'
export const DEFAULT_LOCAL_SECRET_KEY = 'silo-admin'

export function isLocalMode(env: Env = process.env): boolean {
  const value = (env.LOCAL ?? '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

/** 本地 S3 兼容端点（默认 SILO）；只接受本机地址。 */
export function localEndpoint(env: Env = process.env): string {
  return (env.S3_ENDPOINT ?? env.MINIO_ENDPOINT ?? DEFAULT_LOCAL_ENDPOINT).replace(/\/+$/, '')
}

export function localBucket(env: Env = process.env): string {
  return env.R2_BUCKET ?? DEFAULT_LOCAL_BUCKET
}

/** 本地桶的匿名读地址：path-style，`<endpoint>/<bucket>/<key>`。 */
export function localPublicBase(env: Env = process.env): string {
  return `${localEndpoint(env)}/${localBucket(env)}`
}

/**
 * 发布进度的落盘路径。本地与线上分开，切回线上时不会因为 target 变化触发全量重传。
 */
export function publishStatePath(root: string, env: Env = process.env): string {
  return resolve(root, 'data', isLocalMode(env) ? '.publish-state.local.json' : '.publish-state.json')
}
