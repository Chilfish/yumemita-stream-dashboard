import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { ensureDevServices } from './lib/dev-services.ts'
import { loadEnvFiles } from './lib/env.ts'

/**
 * `bun run dev`：先确保本地 Postgres / 库 / 迁移 / 开发代理就绪，再启动 Astro。
 *
 * Postgres 与代理是独立后台进程：Astro 退出或被 kill 后继续运行，
 * 重复执行本命令只会复用它们。参数原样透传（如 `--port 4322`）。
 * `--local` 等价于 `LOCAL=1`，同时把数据库、对象存储与媒体地址切到本机。
 */

if (process.argv.includes('--local')) {
  process.env.LOCAL = '1'
  process.argv = process.argv.filter(arg => arg !== '--local')
}

loadEnvFiles()

try {
  await ensureDevServices()
}
catch (error) {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`)
  console.error('[dev] 本地服务未就绪，已取消启动 Astro。排查见 docs/engineering/local-database.md')
  process.exit(1)
}

const require = createRequire(import.meta.url)
const astroBin = join(dirname(require.resolve('astro/package.json')), 'bin', 'astro.mjs')
// Astro 必须跑在 Node 下：Bun 运行时的 fetch 会让 miniflare 的 dispatchFetch ECONNREFUSED。
const node = process.env.NODE || 'node'
const child = spawn(node, [astroBin, 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal)
  })
}

child.on('error', (error) => {
  console.error(`[dev] 启动 Astro 失败：${error.message}`)
  process.exit(1)
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
