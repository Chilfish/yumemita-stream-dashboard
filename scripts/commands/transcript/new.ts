#!/usr/bin/env bun
/**
 * 从模板建一篇逐字稿。
 *
 *   bun scripts/transcript-new.ts W0bKqP-Eyj4 --dataset nonoka
 *   bun scripts/transcript-new.ts W0bKqP-Eyj4 --dataset nonoka --force
 *
 * 日期与标题从 `data/<dataset>/manifest.json` 带出，省掉手写 frontmatter 的成本。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import type { BatchManifest } from '../src/types/dataset.ts'

interface DatasetSource {
  id: string
  label: string
  datapackDir?: string
  manifest?: string
}

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONTENT_ROOT = join(APP_ROOT, 'content', 'transcripts')
const TEMPLATE_PATH = join(CONTENT_ROOT, '.template.md')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')

const USAGE = `用法：bun scripts/transcript-new.ts <videoId> --dataset <id> [选项]

从 content/transcripts/.template.md 建一篇稿，日期 / 标题从 manifest 带出。

选项：
  --dataset <id>   目标成员（必须是 data-sources.json 里的 id）
  --force          目标文件已存在时覆盖
  -h, --help       显示本帮助`

const { values, positionals } = parseArgs({
  options: {
    dataset: { type: 'string' },
    force: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
})

function log(message: string): void {
  console.log(`[transcripts] ${message}`)
}

function warn(message: string): void {
  console.warn(`[transcripts]   ! ${message}`)
}

function fail(message: string): never {
  console.error(`[transcripts] ${message}`)
  process.exit(1)
}

if (values.help) {
  console.log(USAGE)
  process.exit(0)
}

const videoId = positionals[0]
if (!videoId)
  fail(`缺少 videoId\n\n${USAGE}`)
if (!values.dataset)
  fail(`缺少 --dataset\n\n${USAGE}`)

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { datasets?: DatasetSource[] }
const dataset = (config.datasets ?? []).find(item => item.id === values.dataset)
if (!dataset)
  fail(`data-sources.json 里没有 dataset：${values.dataset}`)

if (!existsSync(TEMPLATE_PATH))
  fail(`找不到模板 ${relative(APP_ROOT, TEMPLATE_PATH)}；它应该随仓库提交`)

const manifestPath = resolve(
  APP_ROOT,
  dataset.manifest ?? join(dataset.datapackDir ?? `data/${dataset.id}`, 'manifest.json'),
)
let stream: BatchManifest['streams'][number] | null = null
if (existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BatchManifest
    stream = (manifest.streams ?? []).find(item => item.videoId === videoId) ?? null
  }
  catch (error) {
    warn(`读取 ${relative(APP_ROOT, manifestPath)} 失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

if (!stream)
  warn(`manifest 里没有 ${videoId}，date / title 留空，记得手填`)

/** YAML 里带特殊字符就加双引号，避免被行内数组或注释规则误伤。 */
function yamlScalar(value: string): string {
  if (value === '')
    return '""'
  const needsQuotes = /^\s|\s$|[:#[\]{},"'&*?|>@`]/.test(value)
  if (!needsQuotes)
    return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

const date = stream?.date ?? (stream?.startedAt ?? '').slice(0, 10)
const title = stream?.title ?? ''
const tokens: Record<string, string> = {
  videoId,
  datasetId: dataset.id,
  member: dataset.id,
  members: dataset.id,
  date,
  title: title ? yamlScalar(title) : '""',
  summary: '""',
  today: new Date().toISOString().slice(0, 10),
}

const template = readFileSync(TEMPLATE_PATH, 'utf8')
const filled = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
  const replacement = tokens[key]
  return replacement === undefined ? match : replacement
})

const targetDir = join(CONTENT_ROOT, dataset.id)
const targetPath = join(targetDir, `${videoId}.md`)
if (existsSync(targetPath) && !values.force)
  fail(`${relative(APP_ROOT, targetPath)} 已存在；确认要覆盖请加 --force`)

mkdirSync(targetDir, { recursive: true })
writeFileSync(targetPath, filled.endsWith('\n') ? filled : `${filled}\n`, 'utf8')

log(`已创建 ${relative(APP_ROOT, targetPath)}`)
if (stream)
  log(`  ${date} · ${title}`)
else
  warn('title 与 date 需要手填；videoId 已写入 frontmatter')
log('写完运行：bun run publish:transcripts')
