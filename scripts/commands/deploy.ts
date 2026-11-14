#!/usr/bin/env bun
/**
 * 部署到 Cloudflare Workers。固定按线上处理，不受 `LOCAL` 开关影响。
 *
 *   bun run ymmt deploy              # build + wrangler deploy
 *   bun run ymmt deploy --no-deploy  # 只构建并校验产物
 *
 * 1. 强制 `LOCAL=0`：`.dev.vars` 里的 `LOCAL=1` 不会带进构建；
 * 2. `loadEnvFiles()` 走线上分支，用 `DATABASE_URL_ONLINE` 等线上目标；
 * 3. `PUBLIC_R2_BASE` 指向本机时拒绝（它会被内联进客户端 bundle）；
 * 4. 构建后扫描 `dist/`：出现本机媒体 / 代理地址就中止，不部署；
 * 5. 以上通过才 `wrangler deploy --config dist/server/wrangler.json`。
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Option } from 'commander'
import { isLocalUrl } from '@/lib/local-url.ts'
import type { CommandSpec } from '@scripts/lib/cli/runtime.ts'
import { CliError, ConfigError } from '@scripts/lib/cli/exit.ts'
import { createLogger, type Logger } from '@scripts/lib/cli/logger.ts'
import { loadEnvFiles } from '@scripts/lib/env.ts'
import { DEFAULT_LOCAL_PROXY_ENDPOINT, localPublicBase } from '@scripts/lib/local-config.ts'

// 文件在 scripts/commands/，仓库根在上一级。
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DIST_ROOT = join(APP_ROOT, 'dist')

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.css', '.txt', '.xml', '.md'])

export interface DeployOptions {
  /** `--no-deploy`：只构建并校验产物，不执行 wrangler deploy。 */
  noDeploy?: boolean
  /** 全局 --dry-run：只报告将执行的步骤与地址检查结果，不构建、不部署。 */
  dryRun?: boolean
  log?: Logger
}

export interface DeployData {
  appRoot: string
  distRoot: string
  publicBase: string
  mode: 'remote'
  noDeploy: boolean
  built: boolean
  localHits: string[]
  deployed: boolean
}

export interface DeployResult {
  exitCode: number
  data: DeployData
}

/** 只认「我们自己的」本机地址：媒体库 / 代理 / 本地开发端口，别的 127.0.0.1（如系统代理变量）不算。 */
function localMarkers(): string[] {
  const endpoints = [
    localPublicBase(),
    DEFAULT_LOCAL_PROXY_ENDPOINT,
    process.env.S3_ENDPOINT ?? '',
    process.env.MINIO_ENDPOINT ?? '',
  ]
  const ports = new Set(['9000', '4444', '4321', '8787'])
  for (const endpoint of endpoints) {
    try {
      const port = new URL(endpoint).port
      if (port) ports.add(port)
    }
    catch {}
  }
  const markers = new Set<string>(endpoints.filter(Boolean))
  for (const port of ports) {
    markers.add(`http://127.0.0.1:${port}`)
    markers.add(`http://localhost:${port}`)
  }
  return [...markers]
}

/** 递归列出 dist 下的文本文件；二进制资产不参与扫描。 */
function textFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...textFiles(path))
      continue
    }
    if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name)))
      files.push(path)
  }
  return files
}

function findLocalAddresses(): string[] {
  const markers = localMarkers()
  const hits: string[] = []
  for (const file of textFiles(DIST_ROOT)) {
    const content = readFileSync(file, 'utf8')
    for (const marker of markers) {
      const index = content.indexOf(marker)
      if (index === -1) continue
      const line = content.slice(0, index).split('\n').length
      hits.push(`${relative(APP_ROOT, file)}:${line} → ${marker}`)
    }
  }
  return hits
}

function runStep(args: string[], label: string): void {
  const result = spawnSync(args[0] as string, args.slice(1), {
    cwd: APP_ROOT,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) {
    throw new CliError(`${label} 启动失败：${result.error.message}`, {
      code: 'COMMAND_FAILED',
      hint: `手动跑一遍看细节：${args.join(' ')}`,
      cause: result.error,
    })
  }
  if (result.status !== 0) {
    throw new CliError(`${label} 失败（退出码 ${result.status ?? 'unknown'}）`, {
      code: 'COMMAND_FAILED',
      hint: `手动跑一遍看细节：${args.join(' ')}`,
      context: { status: result.status },
    })
  }
}

/**
 * 业务主体：强制线上环境 → 校验 `PUBLIC_R2_BASE` → 从零构建 → 扫描 `dist/` → 可选部署。
 *
 * 永远按线上处理：一开始就把 `LOCAL` 设成 `0`，再用 `loadEnvFiles()` 选 `*_ONLINE` 那套值。
 * 构建产物里出现本机地址时中止（退出码 1），绝不部署一个指向 localhost 的构建。
 */
export async function runDeploy(options: DeployOptions): Promise<DeployResult> {
  const log = options.log ?? createLogger({ name: 'deploy' })
  const noDeploy = options.noDeploy === true
  const data: DeployData = {
    appRoot: APP_ROOT,
    distRoot: DIST_ROOT,
    publicBase: '',
    mode: 'remote',
    noDeploy,
    built: false,
    localHits: [],
    deployed: false,
  }

  // 线上模式是硬约束：不管 `.dev.vars` 与调用方怎么写，都不许部署本地构建。
  process.env.LOCAL = '0'
  loadEnvFiles({ log: false })
  log.info('部署固定按线上处理（LOCAL=0），不使用 `.dev.vars` 的本地目标')

  const publicBase = (process.env.PUBLIC_R2_BASE ?? '').replace(/\/+$/, '')
  data.publicBase = publicBase
  if (!publicBase) {
    log.warn('PUBLIC_R2_BASE 未设置：构建产物会回退到 /data/，线上封面 / 表情会 404')
  }
  else if (isLocalUrl(publicBase)) {
    throw new ConfigError(`PUBLIC_R2_BASE 指向本机（${publicBase}）：这个构建属于本地预览，不能部署`, {
      code: 'LOCAL_PUBLIC_BASE',
      hint: '把 .dev.vars 里 PUBLIC_R2_BASE_ONLINE 配成对象存储的公开地址，然后重跑 bun run ymmt deploy',
      context: { publicBase },
    })
  }

  if (options.dryRun) {
    log.info(`dry-run：将清空 dist/ 并构建，PUBLIC_R2_BASE ${publicBase || '未设置'}${noDeploy ? '（--no-deploy：不部署）' : ''}`)
    return { exitCode: 0, data }
  }

  /** 从零构建：上一次的 `.prerender` 残留会引用已删除的 chunk，导致 build 失败。 */
  rmSync(DIST_ROOT, { recursive: true, force: true })
  runStep(['bun', 'run', 'build'], 'astro build')
  data.built = true

  const localHits = findLocalAddresses()
  data.localHits = localHits
  if (localHits.length > 0) {
    log.error('构建产物里有本机地址，已中止部署：')
    for (const hit of localHits.slice(0, 10)) log.error(`  - ${hit}`)
    if (localHits.length > 10) log.error(`  - … 另有 ${localHits.length - 10} 处`)
    throw new CliError('构建产物里有本机地址，未部署', {
      code: 'LOCAL_ADDRESSES_IN_BUILD',
      hint: '检查 .dev.vars 里指向本机的 PUBLIC_R2_BASE / S3_ENDPOINT，然后重跑 bun run ymmt deploy',
      context: { hits: localHits.slice(0, 10), total: localHits.length },
    })
  }

  if (noDeploy) {
    log.info(`构建校验通过（PUBLIC_R2_BASE ${publicBase || '未设置'}），已跳过 wrangler deploy`)
    return { exitCode: 0, data }
  }

  log.info(`部署 ${publicBase} → Cloudflare Workers`)
  runStep(['bun', 'x', 'wrangler', 'deploy', '--config', 'dist/server/wrangler.json'], 'wrangler deploy')
  data.deployed = true

  return { exitCode: 0, data }
}

export const deploySpec: CommandSpec = {
  id: 'deploy',
  description: '构建并部署到 Cloudflare Workers（固定线上环境）',
  details: [
    '固定按线上处理，不受 `LOCAL` 开关影响：命令一开始就把 `LOCAL` 设成 `0`，并用 `*_ONLINE` 那套变量。',
    '',
    '1. `PUBLIC_R2_BASE` 指向本机时直接拒绝（它会被内联进客户端 bundle）；',
    '2. 清空 `dist/` 后从零构建（上次的 `.prerender` 残留会让 build 失败）；',
    '3. 扫描构建产物：出现本机媒体 / 代理地址就中止，不部署；',
    '4. 以上通过才 `wrangler deploy --config dist/server/wrangler.json`。',
    '',
    '全局 `--dry-run` 只报告将要执行的步骤与 `PUBLIC_R2_BASE` 检查结果，不构建、不部署。',
  ].join('\n'),
  examples: [
    'bun run ymmt deploy',
    'bun run ymmt deploy --no-deploy',
    'bun run ymmt deploy --dry-run',
  ],
  options: [new Option('--no-deploy', '只构建并校验产物，不执行 wrangler deploy')],
  async run(ctx) {
    const result = await runDeploy({
      // `--no-deploy` 是 negated flag：commander 把它的属性名记作 `deploy`，
      // 传了 `--no-deploy` 时 `ctx.options.deploy === false`。
      noDeploy: ctx.options.deploy === false,
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    return { exitCode: result.exitCode, data: result.data }
  },
}
