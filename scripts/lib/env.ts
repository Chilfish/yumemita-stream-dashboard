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
 * 解析 `.env` 格式的文本；不做变量展开，只处理注释、空行与成对引号。
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

const ENV_FILES = ['.env', '.dev.vars', '.env.local'] as const

/**
 * 决定「数据写到哪」的键：非本地模式下只认 `.env`。
 * `.env.local` / `.dev.vars` 里的这两个值是本机开发用的，不该影响线上运行。
 */
const LOCAL_ONLY_KEYS = new Set(['DATABASE_URL', 'NEON_HTTP_ENDPOINT'])

export interface LoadEnvOptions {
  /**
   * 开发服务器专用：`bun run dev` 始终准备并连本机库，不受 `LOCAL` 开关影响，
   * 因此无条件采用 `.env.local` / `.dev.vars` 的地址。普通脚本不要传。
   */
  devServer?: boolean
}

/**
 * 本地脚本读取 .env / .dev.vars / .env.local。
 * Bun 只会自动加载 .env，`.dev.vars` 是 Cloudflare 的本地约定，需要手动读。
 * 后面的文件覆盖前面的（`.env.local` 优先级最高）。
 *
 * 不能沿用「已经在 `process.env` 里就跳过」的写法：Bun 启动时会把 `.env*` 先灌一遍，
 * 且同名键先读到的赢（`.env` 会盖住 `.env.local`），和这里声明的优先级正好相反。
 * 所以以本函数读到的文件为准，只有 `LOCAL` 开关允许运行环境直接覆盖。
 *
 * `LOCAL=1` 才会采用 `.env.local` / `.dev.vars` 的本地数据库与代理地址；
 * `LOCAL=0`（或不设）这两项只认 `.env`，避免「对象传到 R2、元数据写进本地库」。
 * 其余键（R2 凭据、SITE_URL 等）仍按文件顺序覆盖。
 */
export function loadEnvFiles(options: LoadEnvOptions = {}, cwd = process.cwd()): void {
  const files = ENV_FILES.map(name => ({
    path: resolve(cwd, name),
    values: {} as Record<string, string>,
  }))
  for (const file of files) {
    if (existsSync(file.path)) file.values = readEnvFile(file.path)
  }

  const local = resolveLocalMode(files)
  const fromFile = new Set<string>()

  for (const [index, file] of files.entries()) {
    const devFile = index > 0

    for (const [key, value] of Object.entries(file.values)) {
      // 开关只认运行环境：命令行 / `bun run dev --local` 设的 LOCAL 不被文件改回去。
      if (key === 'LOCAL' && process.env.LOCAL !== undefined && !fromFile.has(key)) continue
      if (devFile && !local && !options.devServer && LOCAL_ONLY_KEYS.has(key)) continue
      process.env[key] = value
      fromFile.add(key)
    }
  }

  applyLocalOverrides()
  logEnvironment('env')
}

/** 开关的优先级：运行环境 > `.env.local` > `.dev.vars` > `.env`。 */
function resolveLocalMode(
  files: ReadonlyArray<{ values: Record<string, string> }>,
): boolean {
  if (process.env.LOCAL !== undefined)
    return isLocalMode(process.env)
  const merged: Record<string, string | undefined> = {}
  for (const file of files) Object.assign(merged, file.values)
  return isLocalMode(merged)
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
    throw new Error(`缺少环境变量 ${name}；请在 .env 或 .dev.vars 中配置`)
  }
  return value
}
