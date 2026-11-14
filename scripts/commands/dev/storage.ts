#!/usr/bin/env bun
/**
 * 只准备本地对象存储（SILO）与桶，不启动 Astro。
 *
 *   LOCAL=1 bun run dev:storage
 *
 * `bun run dev` 在 `LOCAL=1` 时会自动调用同一条路径；单独跑 publish / fetch
 * 之前也可以用它确认端点、桶和匿名读都就绪。
 */
import process from 'node:process'
import { ensureSiloRunning } from './lib/dev-silo.ts'
import { loadEnvFiles } from './lib/env.ts'
import { isLocalMode, localPublicBase } from './lib/local-config.ts'

loadEnvFiles()

if (!isLocalMode()) {
  console.error('[storage] 需要 LOCAL=1（可写在 .dev.vars）')
  process.exit(1)
}

const result = await ensureSiloRunning()
if (!result.started) {
  console.error(`[storage] ${result.reason}`)
  process.exit(1)
}

console.log(`[storage] 端点 ${result.endpoint}，公开读地址 ${localPublicBase()}`)
