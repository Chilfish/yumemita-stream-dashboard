/**
 * `bun run ymmt dev server`（别名 `bun run dev`）：先确保本地 Postgres / 库 / 迁移 / 开发代理就绪，再启动 Astro。
 *
 * Postgres 与代理是独立后台进程：Astro 退出或被 kill 后继续运行，
 * 重复执行本命令只会复用它们。参数原样透传（如 `--port 4322`）。
 * `--local` 等价于 `LOCAL=1`，同时把数据库、对象存储与媒体地址切到本机。
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { Option } from 'commander'
import type { CommandSpec } from '@scripts/lib/cli/runtime.ts'
import { CliError } from '@scripts/lib/cli/exit.ts'
import { createLogger, type Logger } from '@scripts/lib/cli/logger.ts'
import { ensureDevServices } from '@scripts/lib/dev-services.ts'

/** 这些是 ymmt 自己的参数，不往 Astro 传。 */
const YMMT_FLAGS = new Set([
  'dev',
  'server',
  '--local',
  '--json',
  '--quiet',
  '--dry-run',
])
/** 需要吃掉一个值的 ymmt 参数。 */
const YMMT_VALUE_FLAGS = new Set(['--log-level', '--log-file'])

export interface DevServerOptions {
  /** `--local`：等价于 `LOCAL=1`。 */
  local?: boolean
  /** 额外透传给 `astro dev` 的参数。 */
  extraArgs?: string[]
  /** 全局 --dry-run：只做服务就绪检查，不启动 Astro。 */
  dryRun?: boolean
  log?: Logger
}

export interface DevServerData {
  astroBin: string
  node: string
  forwarded: string[]
  spawned: boolean
  exitCode: number | null
}

export interface DevServerResult {
  exitCode: number
  data: DevServerData
}

/**
 * 从 `process.argv` 里抠出要透传给 `astro dev` 的参数。
 *
 * commander 不认识 Astro 的任意参数（`--port`、`--host` …），spec 又不支持
 * `.allowUnknownOption()` / rest 位置参数，所以这里直接读原始 argv：
 * 取 `server`（或 `dev`）之后的全部参数，再剔除 ymmt 自己的 flag。
 */
function passthroughArgs(argv: string[]): string[] {
  const start = argv.indexOf('server') >= 0 ? argv.indexOf('server') : argv.indexOf('dev')
  const tail = start >= 0 ? argv.slice(start + 1) : argv
  const forwarded: string[] = []
  for (let index = 0; index < tail.length; index += 1) {
    const arg = tail[index] as string
    if (arg === '--') {
      forwarded.push(...tail.slice(index + 1))
      break
    }
    if (YMMT_FLAGS.has(arg))
      continue
    if (YMMT_VALUE_FLAGS.has(arg)) {
      index += 1
      continue
    }
    forwarded.push(arg)
  }
  return forwarded
}

/**
 * 业务主体：确保本地服务就绪后以 Node 启动 `astro.mjs dev`，并把信号与退出码透传出去。
 *
 * Astro 必须跑在 Node 下：Bun 运行时的 fetch 会让 miniflare 的 dispatchFetch ECONNREFUSED。
 */
export async function runDevServer(options: DevServerOptions): Promise<DevServerResult> {
  const log = options.log ?? createLogger({ name: 'dev.server' })

  if (options.local)
    process.env.LOCAL = '1'

  const require = createRequire(import.meta.url)
  const astroBin = join(dirname(require.resolve('astro/package.json')), 'bin', 'astro.mjs')
  const node = process.env.NODE || 'node'
  const forwarded = options.extraArgs ?? []

  try {
    await ensureDevServices()
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new CliError(`${message}\n本地服务未就绪，已取消启动 Astro。排查见 docs/engineering/local-database.md`, {
      code: 'DEV_SERVICES_UNAVAILABLE',
      hint: '先运行 bun run ymmt dev db 看 Postgres / 代理哪里没起来；排查步骤见 docs/engineering/local-database.md',
      cause: error,
    })
  }

  if (options.dryRun) {
    log.info(`dry-run：本地服务就绪，将启动 ${node} ${astroBin} dev ${forwarded.join(' ')}`.trimEnd())
    return {
      exitCode: 0,
      data: { astroBin, node, forwarded, spawned: false, exitCode: null },
    }
  }

  const child = spawn(node, [astroBin, 'dev', ...forwarded], {
    stdio: 'inherit',
    env: process.env,
  })

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (!child.killed) child.kill(signal)
    })
  }

  child.on('error', (error) => {
    log.error(`启动 Astro 失败：${error.message}`)
    process.exitCode = 1
  })

  const code = await new Promise<number | null>((resolvePromise) => {
    child.on('exit', exitCode => resolvePromise(exitCode))
  })

  return {
    exitCode: code ?? 0,
    data: { astroBin, node, forwarded, spawned: true, exitCode: code },
  }
}

export const devServerSpec: CommandSpec = {
  id: 'dev.server',
  description: '启动开发服务器：先拉起 Postgres / 库 / 迁移 / 代理，再跑 Astro dev',
  details: [
    '等同于原来的 `bun run dev`。Postgres 与开发代理是独立后台进程：Astro 退出后继续运行，重复执行只会复用它们。',
    '',
    '透传 Astro 参数：commander 需要认识所有选项，而 Astro 的 `--port` / `--host` 之类它不认识，',
    '所以用 `--` 分隔——`--` 之后的参数会进 `ctx.args` 并原样交给 `astro dev`；',
    '没有 `--` 时退回读 `process.argv` 里 `server` / `dev` 之后的尾巴（剔掉 ymmt 自己的 `--local` / `--json` / `--quiet` / `--dry-run` / `--log-level` / `--log-file`）。',
    '',
    '  bun run ymmt dev server -- --port 4322 --host 0.0.0.0',
    '  bun run ymmt dev server --local -- --port 4322',
    '',
    '`--local` 等价于 `LOCAL=1`：数据库、对象存储与媒体地址一起切到本机。',
    '全局 `--dry-run` 只做本地服务就绪检查，不启动 Astro。',
  ].join('\n'),
  examples: [
    'bun run dev',
    'bun run ymmt dev server',
    'bun run ymmt dev server --local',
    'bun run ymmt dev server -- --port 4322',
  ],
  options: [
    new Option('--local', '等价于 LOCAL=1：数据库、对象存储与媒体地址都切到本机'),
  ],
  // 可选可变参数：让 `-- --port 4322` 落进 ctx.args 而不是被 commander 当成多余参数。
  arguments: [{ name: 'astroArgs...', description: '`--` 之后原样透传给 astro dev 的参数', required: false }],
  async run(ctx) {
    // `--` 之后的参数 commander 会放进 ctx.args；没有 `--` 时退回读 process.argv 的尾巴。
    const extraArgs = ctx.args.length > 0 ? ctx.args.slice() : passthroughArgs(process.argv.slice(2))
    const result = await runDevServer({
      local: ctx.flag('local'),
      extraArgs,
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    return { exitCode: result.exitCode, data: result.data }
  },
}
