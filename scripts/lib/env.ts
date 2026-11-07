import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_LOCAL_DATABASE_URL,
  DEFAULT_LOCAL_PROXY_ENDPOINT,
  describeEnvironment,
  isLocalMode,
  isLocalUrl,
  localPublicBase,
} from './local-config.ts'

/**
 * 解析 `.dev.vars` 格式的文本；不做变量展开，只处理注释、空行与成对引号。
 * `KEY=a=b` 只按第一个 `=` 切分，值里可以再出现 `=`。
 */
export function parseEnvContent(content: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator === -1) continue
    const key = trimmed.slice(0, separator).trim()
    if (!key) continue
    let value = trimmed.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

/** 只读一个环境文件，不写入 `process.env`；用于「只认线上凭据」的同步脚本。 */
export function readEnvFile(path: string): Record<string, string> {
  return parseEnvContent(readFileSync(path, 'utf8'))
}

/** 唯一的环境文件：wrangler / astro dev 原生读它，脚本也读它。 */
export const ENV_FILE = '.dev.vars'

/** `KEY_ONLINE` 是「线上模式用这套值」的写法：同一份文件里放本地与线上两套目标。 */
const ONLINE_SUFFIX = '_ONLINE'

export interface LoadEnvOptions {
  /** 仓库根目录；默认当前工作目录。 */
  cwd?: string
  /** 目标环境那行的前缀，默认 `env`；传脚本名可以沿用 `[publish-data] …` 的日志。 */
  prefix?: string
}

/**
 * 读 `.dev.vars`，按 `LOCAL` 决定用哪一套值。
 *
 * - 文件里的普通键是**本地开发**者的值（`DATABASE_URL` 指本机库，wrangler / astro dev 也直接读它们）；
 * - 线上目标写在 `DATABASE_URL_ONLINE` 这类 `*_ONLINE` 键里：`LOCAL=0` 时替换同名键，`LOCAL=1` 时忽略；
 * - 文件只补运行环境里没有的键：命令行显式传的变量（`LOCAL=0 SITE_URL=… bun run …`）始终优先；
 * - `LOCAL=1` 时再兜底一次，数据库、代理、媒体地址都强制指本机。
 *
 * 线上模式而 `DATABASE_URL` 仍指向本机时把它清掉并提示，
 * 避免「对象传到 R2、元数据却写进本地库」这种混合状态。
 */
export function loadEnvFiles(options: LoadEnvOptions = {}): void {
  const path = resolve(options.cwd ?? process.cwd(), ENV_FILE)
  const values = existsSync(path) ? readEnvFile(path) : {}
  const ambient = new Set(Object.keys(process.env))
  const local = process.env.LOCAL !== undefined ? isLocalMode(process.env) : isLocalMode(values)

  for (const [key, value] of Object.entries(values)) {
    if (key.endsWith(ONLINE_SUFFIX) || ambient.has(key)) continue
    process.env[key] = value
  }

  if (local) {
    applyLocalOverrides()
  }
  else {
    for (const [key, value] of Object.entries(values)) {
      if (!key.endsWith(ONLINE_SUFFIX) || value === '') continue
      const base = key.slice(0, -ONLINE_SUFFIX.length)
      if (ambient.has(base)) continue
      process.env[base] = value
    }

    if (isLocalUrl(process.env.DATABASE_URL)) {
      delete process.env.DATABASE_URL
      console.warn(
        '[env] 线上模式但 DATABASE_URL 指向本机：'
        + `要用线上库请写 DATABASE_URL${ONLINE_SUFFIX}，本地调试请设 LOCAL=1`,
      )
    }
  }

  logEnvironment(options.prefix ?? 'env')
}

/**
 * 在脚本入口打印本次运行的目标环境。
 * 放在加载环境之后、开始做事之前，避免跑完才发现连的是本机还是线上。
 */
export function logEnvironment(prefix: string, env: Record<string, string | undefined> = process.env): void {
  console.log(`[${prefix}] ${describeEnvironment(env)}`)
}

/** `LOCAL=1` 是总开关：文件里写着线上地址也强制切回本机。 */
function applyLocalOverrides(): void {
  if (!isLocalMode()) return
  if (!isLocalUrl(process.env.DATABASE_URL))
    process.env.DATABASE_URL = DEFAULT_LOCAL_DATABASE_URL
  if (!isLocalUrl(process.env.NEON_HTTP_ENDPOINT))
    process.env.NEON_HTTP_ENDPOINT = DEFAULT_LOCAL_PROXY_ENDPOINT
  process.env.PUBLIC_R2_BASE = localPublicBase()
}

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`缺少环境变量 ${name}；请在 ${ENV_FILE} 中配置`)
  }
  return value
}
