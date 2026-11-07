#!/usr/bin/env bun
/**
 * 部署到 Cloudflare Workers。固定按线上处理，不受 `LOCAL` 开关影响。
 *
 *   bun run cf:deploy             # build + wrangler deploy
 *   bun run cf:deploy --no-deploy # 只构建并校验产物
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
import { parseArgs } from 'node:util'
import { isLocalUrl } from '../src/lib/local-url.ts'
import { loadEnvFiles } from './lib/env.ts'
import { DEFAULT_LOCAL_PROXY_ENDPOINT, localPublicBase } from './lib/local-config.ts'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST_ROOT = join(APP_ROOT, 'dist')

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
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.css', '.txt', '.xml', '.md'])

const USAGE = `用法：bun scripts/deploy.ts [选项]

构建并用线上环境部署到 Cloudflare Workers。

选项：
  --no-deploy   只构建并校验产物，不执行 wrangler deploy
  -h, --help    显示本帮助`

const { values } = parseArgs({
  options: {
    'no-deploy': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})

if (values.help) {
  console.log(USAGE)
  process.exit(0)
}

function log(message: string): void {
  console.log(`[deploy] ${message}`)
}

function fail(message: string): never {
  console.error(`[deploy] ${message}`)
  process.exit(1)
}

function run(args: string[], label: string): void {
  const result = spawnSync(args[0] as string, args.slice(1), {
    cwd: APP_ROOT,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error)
    fail(`${label} 启动失败：${result.error.message}`)
  if (result.status !== 0)
    fail(`${label} 失败（退出码 ${result.status ?? 'unknown'}）`)
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

process.env.LOCAL = '0'
loadEnvFiles()

const publicBase = (process.env.PUBLIC_R2_BASE ?? '').replace(/\/+$/, '')
if (!publicBase)
  log('PUBLIC_R2_BASE 未设置：构建产物会回退到 /data/，线上封面 / 表情会 404')
else if (isLocalUrl(publicBase))
  fail(`PUBLIC_R2_BASE 指向本机（${publicBase}）：这个构建属于本地预览，不能部署`)

/** 从零构建：上一次的 `.prerender` 残留会引用已删除的 chunk，导致 build 失败。 */
rmSync(DIST_ROOT, { recursive: true, force: true })
run(['bun', 'run', 'build'], 'astro build')

const localHits = findLocalAddresses()
if (localHits.length > 0) {
  console.error('[deploy] 构建产物里有本机地址，已中止部署：')
  for (const hit of localHits.slice(0, 10)) console.error(`  - ${hit}`)
  if (localHits.length > 10) console.error(`  - … 另有 ${localHits.length - 10} 处`)
  console.error('[deploy] 检查 .dev.vars 里指向本机的 PUBLIC_R2_BASE / S3_ENDPOINT，然后重新构建')
  process.exit(1)
}

if (values['no-deploy']) {
  log(`构建校验通过（PUBLIC_R2_BASE ${publicBase || '未设置'}），已跳过 wrangler deploy`)
  process.exit(0)
}

log(`部署 ${publicBase} → Cloudflare Workers`)
run(['bun', 'x', 'wrangler', 'deploy', '--config', 'dist/server/wrangler.json'], 'wrangler deploy')
