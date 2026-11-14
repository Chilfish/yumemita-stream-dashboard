#!/usr/bin/env bun
/**
 * 只补 VSTATS 单场页，不重抓 meta / 弹幕 / 评论，也不下载媒体。
 *
 *   bun scripts/backfill-vstats.ts --dry-run
 *   bun scripts/backfill-vstats.ts --dataset yuno
 *   bun scripts/backfill-vstats.ts --dataset yuno --ids ids.txt --limit 5
 *
 * 候选取自本地 pack 的 manifest 摘要：`vstatsViews` 为空且 `availability = public` 的场次。
 * VSTATS 对未收录的视频返回 5 字节的 `error`，这类场次只记「未收录」，不算失败；
 * 5xx / 超时按临时失败处理，下轮重试。每轮默认随机取 40 场，避免旧场次永远排在队尾。
 *
 * 改完 pack 后同步 upsert manifest；入库与上传由 daily-update 或手动
 * `db:ingest --ids` / `publish:assets --ids` 完成。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { upsertManifestStream } from './lib/dataset-manifest.ts'
import { deriveVstats, parseVstats, VSTATS_MIN_HTML_BYTES } from './lib/vstats.ts'
import type { StreamDatapack } from '../src/types/datapack.ts'

interface DatasetSource {
  id: string
  label: string
  manifest: string
  datapackDir: string
}

interface ManifestSummary {
  videoId?: string
  availability?: string | null
  vstatsViews?: number | null
}

interface Candidate {
  source: DatasetSource
  videoId: string
}

type Probe =
  | { kind: 'ok', vstats: ReturnType<typeof parseVstats> }
  | { kind: 'missing', detail: string }
  | { kind: 'transient', detail: string }

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')

const OPTIONS = {
  dataset: { type: 'string' },
  ids: { type: 'string' },
  limit: { type: 'string', default: '20' },
  concurrency: { type: 'string', default: '3' },
  'ids-out': { type: 'string' },
  quiet: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const

const USAGE = `用法：bun scripts/backfill-vstats.ts [选项]

只请求 VSTATS 单场页，把 vstats 与派生比值写回本地 pack；不重抓弹幕 / 评论 / 媒体。

选项：
  --dataset <id>      只处理指定 dataset；默认全部
  --ids <文件>        指定 videoId 列表（每行一个），覆盖默认候选
  --limit <n>         本轮最多请求 n 场（全部 dataset 合计），默认 20；0 = 全部
  --concurrency <n>   并发，默认 3
  --ids-out <文件>    把补到的 videoId 写到文件（每行一个）
  --quiet             只打印汇总与更新名单
  --dry-run           只列候选，不发请求、不写文件
  -h, --help          显示本帮助`

if (parseArgs({ options: OPTIONS, args: process.argv.slice(2), allowPositionals: false }).values.help) {
  console.log(USAGE)
  process.exit(0)
}

const { values } = parseArgs({ options: OPTIONS, args: process.argv.slice(2), allowPositionals: false })

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms))
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const current = items[i] as T
    items[i] = items[j] as T
    items[j] = current
  }
  return items
}

function readIds(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
}

function manifestCandidates(source: DatasetSource): Candidate[] {
  const manifestPath = resolve(APP_ROOT, source.manifest)
  if (existsSync(manifestPath)) {
    const manifest = readJson<{ streams?: ManifestSummary[] }>(manifestPath)
    return (manifest.streams ?? [])
      .filter(stream => Boolean(stream.videoId))
      .filter(stream => stream.vstatsViews == null && stream.availability === 'public')
      .map(stream => ({ source, videoId: stream.videoId as string }))
  }

  const dir = resolve(APP_ROOT, source.datapackDir)
  if (!existsSync(dir))
    return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.datapack.json'))
    .map(name => ({ source, videoId: name.slice(0, -'.datapack.json'.length) }))
}

function explicitCandidates(source: DatasetSource, ids: string[]): Candidate[] {
  return ids.map(videoId => ({ source, videoId }))
}

async function probe(videoId: string): Promise<Probe> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`https://www.vstats.jp/video/${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(20_000),
      })
      const html = await response.text()
      if (!response.ok) {
        if (response.status >= 500 && attempt === 0) {
          await sleep(1500)
          continue
        }
        return { kind: 'transient', detail: `HTTP ${response.status}` }
      }
      if (html.length < VSTATS_MIN_HTML_BYTES)
        return { kind: 'missing', detail: `${html.length} bytes` }
      const vstats = parseVstats(html)
      if (vstats.views == null && vstats.avgConcurrent == null)
        return { kind: 'missing', detail: '页面没有统计字段' }
      return { kind: 'ok', vstats }
    }
    catch (error) {
      if (attempt === 0) {
        await sleep(1500)
        continue
      }
      return { kind: 'transient', detail: error instanceof Error ? error.message : String(error) }
    }
  }
  return { kind: 'transient', detail: '重试后仍失败' }
}

function packPath(source: DatasetSource, videoId: string): string {
  return join(resolve(APP_ROOT, source.datapackDir), `${videoId}.datapack.json`)
}

function loadPack(source: DatasetSource, videoId: string): StreamDatapack | null {
  const path = packPath(source, videoId)
  if (!existsSync(path))
    return null
  return readJson<StreamDatapack>(path)
}

function applyVstats(source: DatasetSource, videoId: string, pack: StreamDatapack, vstats: ReturnType<typeof parseVstats>): void {
  const path = packPath(source, videoId)
  pack.vstats = vstats
  pack.derived = {
    ...pack.derived,
    ...deriveVstats(vstats, pack.chat?.total ?? 0, pack.video?.snapshot?.views ?? null),
  }
  writeFileSync(path, `${JSON.stringify(pack, null, 2)}\n`, 'utf8')

  const datapackRel = relative(APP_ROOT, path).replaceAll('\\', '/')
  upsertManifestStream(resolve(APP_ROOT, source.manifest), pack, datapackRel)
}

async function main(): Promise<void> {
  const sources = readJson<{ datasets?: DatasetSource[] }>(CONFIG_PATH).datasets ?? []
  const selected = values.dataset ? sources.filter(source => source.id === values.dataset) : sources
  if (selected.length === 0) {
    console.error(`[vstats] 找不到 dataset：${values.dataset ?? '(data-sources.json 为空)'}`)
    console.error(`[vstats] 可用：${sources.map(source => source.id).join(', ') || '(空)'}`)
    process.exit(1)
  }

  const limit = Number(values.limit)
  const concurrency = Number(values.concurrency)
  if (!Number.isInteger(limit) || limit < 0) {
    console.error('[vstats] --limit 需要是 >= 0 的整数')
    process.exit(1)
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    console.error('[vstats] --concurrency 需要是 >= 1 的整数')
    process.exit(1)
  }

  const explicitIds = values.ids ? readIds(resolve(values.ids)) : null
  const candidates: Candidate[] = []
  for (const source of selected) {
    const list = explicitIds ? explicitCandidates(source, explicitIds) : manifestCandidates(source)
    candidates.push(...list)
  }

  const picked = limit > 0 ? shuffle(candidates).slice(0, limit) : shuffle(candidates)
  console.log(`[vstats] 候选 ${candidates.length} · 本轮 ${picked.length}（并发 ${concurrency}）`)

  if (values['dry-run']) {
    for (const candidate of picked)
      console.log(`[vstats] 候选 ${candidate.source.id}/${candidate.videoId}`)
    return
  }

  const updated: string[] = []
  const missing: string[] = []
  const failures: { candidate: Candidate, detail: string }[] = []
  const skipped: string[] = []
  let done = 0

  const queue = [...picked]
  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      const candidate = queue.shift()
      if (!candidate)
        continue
      const label = `${candidate.source.id}/${candidate.videoId}`
      // 本地没有 pack（安静日没恢复）或已经有 VSTATS 时不发请求。
      const pack = loadPack(candidate.source, candidate.videoId)
      if (!pack || pack.vstats) {
        skipped.push(label)
        if (!values.quiet)
          console.log(`[vstats] ${label} 本地 pack 不存在或已有 VSTATS，跳过`)
        continue
      }

      const result = await probe(candidate.videoId)
      done += 1
      if (result.kind === 'ok') {
        applyVstats(candidate.source, candidate.videoId, pack, result.vstats)
        updated.push(`${candidate.source.id}/${candidate.videoId}`)
        if (!values.quiet)
          console.log(`[vstats] ${label} 补到（平均同接 ${result.vstats.avgConcurrent ?? '—'} / 播放 ${result.vstats.views ?? '—'}）`)
      }
      else if (result.kind === 'missing') {
        missing.push(label)
        if (!values.quiet)
          console.log(`[vstats] ${label} 未收录（${result.detail}）`)
      }
      else {
        failures.push({ candidate, detail: result.detail })
        if (!values.quiet)
          console.log(`[vstats] ${label} 临时失败（${result.detail}）`)
      }
      if (values.quiet && done % 20 === 0)
        console.log(`[vstats] 进度 ${done}/${picked.length}`)
      if (queue.length > 0)
        await sleep(300)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, picked.length) }, () => worker()))

  if (values['ids-out']) {
    const outPath = resolve(values['ids-out'])
    writeFileSync(outPath, updated.length > 0 ? `${updated.map(item => item.split('/')[1]).join('\n')}\n` : '', 'utf8')
  }

  console.log(`[vstats] 完成：补到 ${updated.length} / 未收录 ${missing.length} / 临时失败 ${failures.length} / 跳过 ${skipped.length}`)
  if (updated.length > 0 && !values.quiet) {
    for (const item of updated)
      console.log(`[vstats] 更新 ${item}`)
  }

  // 只有整轮都被临时错误挡住时才让调用方感知；单场失败按「跳过并记录」处理。
  if (failures.length > 0 && updated.length === 0 && missing.length === 0) {
    console.error('[vstats] 本轮全部临时失败，稍后重试')
    process.exitCode = 1
  }
}

await main()
