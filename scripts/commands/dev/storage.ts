/**
 * 只准备本地对象存储（SILO）与桶，不启动 Astro。
 *
 *   LOCAL=1 bun run ymmt dev storage
 *
 * `bun run ymmt dev` 在 `LOCAL=1` 时会自动调用同一条路径；单独跑 publish / fetch
 * 之前也可以用它确认端点、桶和匿名读都就绪。
 */
import type { CommandSpec } from '@scripts/lib/cli/runtime.ts'
import { CliError } from '@scripts/lib/cli/exit.ts'
import { createLogger, type Logger } from '@scripts/lib/cli/logger.ts'
import { ensureSiloRunning } from '@scripts/lib/dev-silo.ts'
import { isLocalMode, localPublicBase } from '@scripts/lib/local-config.ts'

export interface DevStorageOptions {
  /** 全局 --dry-run：只报告模式与目标端点，不启服务。 */
  dryRun?: boolean
  log?: Logger
}

export interface DevStorageData {
  local: boolean
  endpoint: string
  publicBase: string
  started: boolean
}

export interface DevStorageResult {
  exitCode: number
  data: DevStorageData
}

export async function runDevStorage(options: DevStorageOptions): Promise<DevStorageResult> {
  const log = options.log ?? createLogger({ name: 'dev.storage' })

  if (!isLocalMode()) {
    throw new CliError('需要 LOCAL=1（可写在 .dev.vars）', {
      code: 'NOT_LOCAL_MODE',
      hint: '在 .dev.vars 里写 LOCAL=1，或用 LOCAL=1 bun run ymmt dev storage',
    })
  }

  if (options.dryRun) {
    log.info(`dry-run：将启动本地对象存储，公开读地址 ${localPublicBase()}（不启动服务）`)
    return {
      exitCode: 0,
      data: { local: true, endpoint: localPublicBase(), publicBase: localPublicBase(), started: false },
    }
  }

  const result = await ensureSiloRunning()
  if (!result.started) {
    throw new CliError(result.reason ?? '本地对象存储未就绪', {
      code: 'STORAGE_UNAVAILABLE',
      hint: '装好 SILO 并加入 PATH（或用 SILO_BIN 指定路径），然后重跑 bun run ymmt dev storage',
    })
  }

  log.info(`端点 ${result.endpoint}，公开读地址 ${localPublicBase()}`)

  return {
    exitCode: 0,
    data: { local: true, endpoint: result.endpoint, publicBase: localPublicBase(), started: true },
  }
}

export const devStorageSpec: CommandSpec = {
  id: 'dev.storage',
  description: '启动本地对象存储（SILO）并准备桶，不启动 Astro',
  details: '只接受 `LOCAL=1`（可写在 `.dev.vars`）：对象存储端点必须是本机地址。\n'
    + '`bun run ymmt dev` 在本地模式下会自动走同一条路径；单独跑 publish / fetch 之前也可以先用它确认端点、桶与匿名读就绪。',
  examples: [
    'bun run ymmt dev storage',
    'LOCAL=1 bun run ymmt dev storage --json',
  ],
  async run(ctx) {
    const result = await runDevStorage({ dryRun: ctx.dryRun, log: ctx.log })
    return { exitCode: result.exitCode, data: result.data }
  },
}
