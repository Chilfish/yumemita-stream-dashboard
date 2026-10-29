#!/usr/bin/env bun
/**
 * 导入一篇已经写好的逐字稿。
 *
 *   bun scripts/transcript-import.ts <path> --dataset nonoka
 *   bun scripts/transcript-import.ts <path> --dataset nonoka --video-id W0bKqP-Eyj4
 *   bun scripts/transcript-import.ts <path> --dataset nonoka --force
 *
 * 1. videoId 来源顺序：frontmatter → `--video-id` → 文件名日期在 manifest 里的唯一匹配；
 * 2. 复制到 `content/transcripts/<datasetId>/<videoId>.md`，正文不改写；
 * 3. 缺 videoId / date / title 时补进 frontmatter（只补缺的字段）；
 * 4. 目标文件已存在时默认拒绝，加 `--force` 才覆盖。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  normalizeFrontmatter,
  parseFrontmatter,
  parseTranscriptFile,
} from '../src/lib/transcripts.ts'
import type { BatchManifest } from '../src/types/dataset.ts'

interface DatasetSource {
  id: string
  label: string
  datapackDir?: string
  manifest?: string
}

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONTENT_ROOT = join(APP_ROOT, 'content', 'transcripts')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')

const USAGE = `用法：bun scripts/transcript-import.ts <path> --dataset <id> [选项]

把写好的 Markdown 复制进 content/transcripts/<datasetId>/<videoId>.md。

选项：
  --dataset <id>     目标成员（必须是 data-sources.json 里的 id）
  --video-id <id>    frontmatter 没有 videoId 时用它兜底
  --force            目标文件已存在时覆盖
  -h, --help         显示本帮助`

const { values, positionals } = parseArgs({
  options: {
    dataset: { type: 'string' },
    'video-id': { type: 'string' },
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

const sourcePath = positionals[0]
if (!sourcePath)
  fail(`缺少源文件路径\n\n${USAGE}`)
if (!values.dataset)
  fail(`缺少 --dataset\n\n${USAGE}`)

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { datasets?: DatasetSource[] }
const dataset = (config.datasets ?? []).find(item => item.id === values.dataset)
if (!dataset)
  fail(`data-sources.json 里没有 dataset：${values.dataset}`)

const absoluteSource = resolve(sourcePath)
if (!existsSync(absoluteSource))
  fail(`源文件不存在：${absoluteSource}`)

const text = readFileSync(absoluteSource, 'utf8')
const fileName = basename(absoluteSource)

let manifestCache: BatchManifest | null | undefined

function readManifest(): BatchManifest | null {
  if (manifestCache !== undefined)
    return manifestCache
  const rel = dataset?.manifest ?? join(dataset?.datapackDir ?? `data/${dataset?.id}`, 'manifest.json')
  const path = resolve(APP_ROOT, rel)
  if (!existsSync(path)) {
    manifestCache = null
    return null
  }
  try {
    manifestCache = JSON.parse(readFileSync(path, 'utf8')) as BatchManifest
  }
  catch (error) {
    warn(`读取 ${relative(APP_ROOT, path)} 失败：${error instanceof Error ? error.message : String(error)}`)
    manifestCache = null
  }
  return manifestCache
}

/** 从文件名里抠日期：`2026-10-13_标题.md` 或 `20261013_标题.md`。 */
function dateFromName(name: string): string | null {
  const dashed = /(\d{4})-(\d{2})-(\d{2})/.exec(name)
  if (dashed)
    return `${dashed[1]}-${dashed[2]}-${dashed[3]}`
  const compact = /(?:^|\D)(\d{4})(\d{2})(\d{2})(?:\D|$)/.exec(name)
  if (compact)
    return `${compact[1]}-${compact[2]}-${compact[3]}`
  return null
}

function yamlScalar(value: string): string {
  if (value === '')
    return '""'
  const needsQuotes = /^\s|\s$|[:#[\]{},"'&*?|>@`]/.test(value)
  if (!needsQuotes)
    return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** 只补 frontmatter 里缺的字段，正文原样保留。 */
function ensureFrontmatter(
  source: string,
  fields: { videoId: string, date: string | null, title: string | null },
): { text: string, added: string[] } {
  const existing = normalizeFrontmatter(parseFrontmatter(source).data)
  const additions: string[] = []
  if (!existing.videoId)
    additions.push(`videoId: ${yamlScalar(fields.videoId)}`)
  if (!existing.date && fields.date)
    additions.push(`date: ${yamlScalar(fields.date)}`)
  if (!existing.title && fields.title)
    additions.push(`title: ${yamlScalar(fields.title)}`)
  if (additions.length === 0)
    return { text: source, added: [] }

  const normalized = source.replace(/^\uFEFF/, '')
  const block = ['---', ...additions, '---', '', normalized.trimStart()].join('\n')

  const lines = normalized.split('\n')
  if (!/^---[ \t]*$/.test(lines[0] ?? ''))
    return { text: block, added: additions }

  const closing = lines.findIndex((line, index) => index > 0 && /^---[ \t]*$/.test(line))
  if (closing < 0)
    return { text: block, added: additions }

  return {
    text: [lines[0], ...additions, ...lines.slice(1)].join('\n'),
    added: additions,
  }
}

const frontmatter = normalizeFrontmatter(parseFrontmatter(text).data)
let videoId = frontmatter.videoId
let resolvedDate = frontmatter.date
let resolvedTitle = frontmatter.title
let origin: 'frontmatter' | 'flag' | 'manifest' = 'frontmatter'

if (!videoId && values['video-id']) {
  videoId = values['video-id']
  origin = 'flag'
}

if (!videoId) {
  const date = dateFromName(fileName)
  if (!date)
    fail('frontmatter 没有 videoId，文件名里也没有日期；请加 --video-id')

  const manifest = readManifest()
  if (!manifest || !Array.isArray(manifest.streams))
    fail(`frontmatter 没有 videoId，又读不到 ${dataset.id} 的 manifest；请加 --video-id`)

  const candidates = manifest.streams.filter(
    stream => stream.date === date || (stream.startedAt ?? '').slice(0, 10) === date,
  )
  if (candidates.length === 0)
    fail(`manifest 里没有 ${date} 的场次；请用 --video-id 指定`)
  if (candidates.length > 1) {
    console.error(`[transcripts] ${date} 对上 ${candidates.length} 场，请用 --video-id 指定其中一场：`)
    for (const candidate of candidates)
      console.error(`  - ${candidate.videoId}  ${candidate.title}`)
    process.exit(1)
  }
  const matched = candidates[0]
  videoId = matched.videoId
  resolvedDate = resolvedDate ?? matched.date ?? date
  resolvedTitle = resolvedTitle ?? matched.title ?? null
  origin = 'manifest'
}

if (!/^[\w-]{6,}$/.test(videoId))
  warn(`videoId 看起来不像 YouTube id：${videoId}`)

const supplemented = ensureFrontmatter(text, {
  videoId,
  date: resolvedDate,
  title: resolvedTitle,
})

const targetDir = join(CONTENT_ROOT, dataset.id)
const targetPath = join(targetDir, `${videoId}.md`)
if (existsSync(targetPath) && !values.force)
  fail(`${relative(APP_ROOT, targetPath)} 已存在；确认要覆盖请加 --force`)

let parsed: ReturnType<typeof parseTranscriptFile> | null = null
try {
  parsed = parseTranscriptFile(supplemented.text, targetPath)
}
catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

mkdirSync(targetDir, { recursive: true })
const output = supplemented.text.endsWith('\n') ? supplemented.text : `${supplemented.text}\n`
writeFileSync(targetPath, output, 'utf8')

const originLabel = { frontmatter: 'frontmatter', flag: '--video-id', manifest: '文件名日期匹配 manifest' }[origin]
log(`已写入 ${relative(APP_ROOT, targetPath)}（videoId ${videoId}，来源：${originLabel}）`)
for (const line of supplemented.added)
  log(`  补了 frontmatter：${line}`)
if (parsed.frontmatter.title)
  log(`  标题：${parsed.frontmatter.title}`)
log(`  目录：${parsed.toc.length} 节，正文 ${parsed.markdown.split('\n').length} 行`)

const manifest = readManifest()
if (manifest && !(manifest.streams ?? []).some(stream => stream.videoId === videoId))
  warn(`manifest 里没有 ${videoId}，确认 id 没写错（发布时不会拦，索引页会多一条）`)

log('下一步：编辑正文，然后运行 bun run publish:transcripts')
