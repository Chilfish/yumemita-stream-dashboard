#!/usr/bin/env bun
/**
 * 发布数据到对象存储（Cloudflare R2 等）。
 *
 *   bun scripts/publish-data.ts               # 生成并上传
 *   bun scripts/publish-data.ts --no-upload   # 只生成本地文件
 *   bun scripts/publish-data.ts --dataset nonoka
 *
 * 本地 `data/<id>/*.datapack.json` 是**唯一真源**：
 * 1. 由 pack 派生 manifest（摘要索引）与 insights（预聚合）；
 * 2. 写回本地 `data/<id>/`（gitignore，本地 dev 直接复用）；
 * 3. pack → manifest → insights 的顺序上传，索引永远指向已存在的 pack。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { aggregateDataset, buildStreamRows } from '../src/lib/aggregate.ts'
import type { StreamDatapack } from '../src/types/datapack.ts'
import type { BatchManifest } from '../src/types/dataset.ts'
import { buildStreamSummary, isoJst } from './lib/dataset-manifest.ts'
import {
  INSIGHTS_SCHEMA,
  MANIFEST_SCHEMA,
  createUploader,
  datapackKey,
  insightsKey,
  manifestKey,
  readCredentials,
  remoteBase,
  runPool,
} from './lib/object-storage.ts'

interface DatasetSource {
  id: string
  label: string
  color?: string | null
  channelId?: string | null
  datapackDir: string
  subject?: string
  scope?: string
  note?: string
}

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')

const { values } = parseArgs({
  options: {
    dataset: { type: 'string' },
    'no-upload': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})

const USAGE = `用法：bun scripts/publish-data.ts [选项]

由本地 datapack 生成 manifest + insights，并上传到对象存储。

选项：
  --dataset <id>   只发布指定 dataset
  --no-upload      只生成本地文件，不上传
  -h, --help       显示本帮助

上传需要环境变量：R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET`

if (values.help) {
  console.log(USAGE)
  process.exit(0)
}

function fail(message: string): never {
  console.error(`[publish-data] ${message}`)
  process.exit(1)
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function readPacks(source: DatasetSource): StreamDatapack[] {
  const dir = resolve(APP_ROOT, source.datapackDir)
  let files: string[]
  try {
    files = readdirSync(dir).filter(name => name.endsWith('.datapack.json'))
  }
  catch {
    fail(`找不到暂存目录：${dir}`)
  }
  if (files.length === 0)
    fail(`${source.id} 在 ${source.datapackDir}/ 里没有 datapack，先运行抓取或从备份恢复`)

  return files.map((name) => {
    const pack = readJson<StreamDatapack>(join(dir, name))
    const expected = name.replace(/\.datapack\.json$/, '')
    if (pack.video?.id !== expected)
      fail(`${name} 的 video.id 与文件名不一致（${pack.video?.id ?? '缺失'}）`)
    return pack
  })
}

const config = readJson<{ datasets: DatasetSource[] }>(CONFIG_PATH)
if (!Array.isArray(config.datasets) || config.datasets.length === 0)
  fail('data-sources.json 里没有 datasets')

const selected = values.dataset
  ? config.datasets.filter(source => source.id === values.dataset)
  : config.datasets
if (selected.length === 0)
  fail(`data-sources.json 里没有 dataset：${values.dataset}`)

const credentials = readCredentials()
if (!values['no-upload'] && !credentials)
  fail('缺少 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET；只生成文件请加 --no-upload')

const upload = credentials ? createUploader(credentials) : null
const publishStartedAt = isoJst(new Date())
const packUploads: { key: string, body: string }[] = []
const indexUploads: { key: string, body: string }[] = []

for (const source of selected) {
  const packs = readPacks(source)
  const packsById = new Map(packs.map(pack => [pack.video.id, pack]))

  const streams = packs
    .map(pack => buildStreamSummary(pack, datapackKey(source.id, pack.video.id)))
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
    .map((stream, index) => ({ ...stream, rank: index + 1 }))

  const manifest: BatchManifest = {
    schema: MANIFEST_SCHEMA,
    generatedAt: publishStartedAt,
    subject: source.subject ?? source.label,
    channelId: source.channelId ?? null,
    scope: source.scope ?? '',
    count: streams.length,
    note: source.note ?? '',
    streams,
  }
  const totals = aggregateDataset(buildStreamRows(manifest, packsById))
  const insights = { schema: INSIGHTS_SCHEMA, generatedAt: publishStartedAt, totals }

  const dir = resolve(APP_ROOT, source.datapackDir)
  writeJson(join(dir, 'manifest.json'), manifest)
  writeJson(join(dir, 'insights.json'), insights)

  console.log(`[publish-data] ${source.label} (${source.id})：${streams.length} 场，本地已生成 manifest + insights`)

  for (const pack of packs)
    packUploads.push({ key: datapackKey(source.id, pack.video.id as string), body: JSON.stringify(pack) })
  indexUploads.push({ key: manifestKey(source.id), body: JSON.stringify(manifest) })
  indexUploads.push({ key: insightsKey(source.id), body: JSON.stringify(insights) })
}

if (!upload) {
  console.log('[publish-data] 已跳过上传（--no-upload）')
  console.log(`[publish-data] 手动上传示例：rclone sync data/<id> r2:<bucket>/<id>`)
  process.exit(0)
}

console.log(`[publish-data] 上传 ${packUploads.length} 个 datapack...`)
await runPool(packUploads, 8, async (item) => {
  await upload(item.key, item.body)
})

// 索引最后写：即使中途失败，也是“多一个 pack”而不是“指向不存在的 pack”。
console.log(`[publish-data] 上传 ${indexUploads.length} 个索引...`)
await runPool(indexUploads, 2, async (item) => {
  await upload(item.key, item.body)
})

const base = remoteBase()
console.log(`[publish-data] 完成${base ? `：${base}` : ''}`)
if (base)
  console.log(`[publish-data] 校验可达性：bun run validate:data -- --remote`)
