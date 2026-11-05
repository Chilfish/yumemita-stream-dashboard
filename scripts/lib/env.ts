import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 本地脚本读取 .env / .dev.vars / .env.local。
 * Bun 只会自动加载 .env，`.dev.vars` 是 Cloudflare 的本地约定，需要手动读。
 * 后面的文件覆盖前面的（`.env.local` 优先级最高），但真实进程环境始终优先。
 */
export function loadEnvFiles(cwd = process.cwd()): void {
  const fromFile = new Set<string>()

  for (const name of ['.env', '.dev.vars', '.env.local']) {
    const path = resolve(cwd, name)
    if (!existsSync(path)) continue

    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const separator = trimmed.indexOf('=')
      if (separator === -1) continue
      const key = trimmed.slice(0, separator).trim()
      let value = trimmed.slice(separator + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (key in process.env && !fromFile.has(key)) continue
      process.env[key] = value
      fromFile.add(key)
    }
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`缺少环境变量 ${name}；请在 .env 或 .dev.vars 中配置`)
  }
  return value
}
