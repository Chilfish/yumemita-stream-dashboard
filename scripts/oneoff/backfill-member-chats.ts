#!/usr/bin/env bun
/**
 * 临时脚本：只补 `chat.memberChats`，不重抓 meta / 弹幕 / 评论 / VSTATS。
 *
 *   bun scripts/oneoff/backfill-member-chats.ts --dry-run
 *   bun scripts/oneoff/backfill-member-chats.ts --dataset yuno --limit 10
 *   bun scripts/oneoff/backfill-member-chats.ts --dataset arale --ids ids.txt --upload
 *
 * 数据源是本地 `temp/youtube-live/<日期>_<成员>_<videoId>/danmaku/danmaku_*.jsonl`；
 * 只改 `data/<datasetId>/*.datapack.json`。默认不上传，确认后加 `--upload` 写回对象存储。
 * 默认处理「已有 pack 且缺 memberChats」的场次；`--force` 连已有的也重算。
 *
 * 完成后可删除本脚本。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadEnvFile } from '@chilfish/devkit/env'
import { devkit } from '../dev.config.ts'
import type { ChatRecord } from '@scripts/lib/live-chat.ts'
import { chatTimestamp, collectMemberChats, memberChannelMap, type MemberSource } from '@scripts/lib/member-chats.ts'
import type { StreamDatapack } from '@/types/datapack.ts'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ANY_DANMAKU_RE = /^danmaku_.*\.jsonl$/

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    dataset: { type: 'string' },
    ids: { type: 'string' },
    limit: { type: 'string', default: '0' },
    force: { type: 'boolean' },
    upload: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})

const USAGE = `用法：bun scripts/oneoff/backfill-member-chats.ts [选项]

从本地弹幕 jsonl 重算 chat.memberChats，写回 data/<datasetId>/*.datapack.json。
默认只处理缺少该字段的场次，不上传对象存储。

选项：
  --root <目录>     会话根目录，默认 $STREAM_SESSION_ROOT 或 ./temp/youtube-live
  --dataset <id>    只处理指定 dataset
  --ids <文件>      指定 videoId 列表（每行一个），需同时指定 --dataset
  --limit <n>       本次最多处理 n 场，0 = 全部
  --force           已有 memberChats 的场次也重算
  --upload          同时写回对象存储（需要 R2 凭据）
  --dry-run         只列出目标，不写文件
  -h, --help        显示本帮助`

if (values.help) {
  console.log(USAGE)
  process.exit(0)
}

function fail(message: string): never {
  console.error(`[member-chats] ${message}`)
  process.exit(1)
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

interface DatasetSource extends MemberSource {
  datapackDir: string
}

const config = readJson<{ datasets: DatasetSource[] }>(join(APP_ROOT, 'data-sources.json'))
if (!Array.isArray(config.datasets) || config.datasets.length === 0)
  fail('data-sources.json 里没有 datasets')

const selected = values.dataset
  ? config.datasets.filter(source => source.id === values.dataset)
  : config.datasets
if (selected.length === 0)
  fail(`data-sources.json 里没有 dataset：${values.dataset}`)
if (values.ids && selected.length !== 1)
  fail('用 --ids 时请同时指定且只指定一个 --dataset')

const root = resolve(values.root ?? process.env.STREAM_SESSION_ROOT ?? join(APP_ROOT, 'temp', 'youtube-live'))
if (!existsSync(root))
  fail(`会话根目录不存在：${root}`)
const limit = Math.max(0, Number(values.limit) || 0)
const dryRun = values['dry-run'] === true
const upload = values.upload === true

let store: Awaited<ReturnType<typeof createStore>> = null
if (upload) {
  store = await createStore()
  if (!store)
    fail('缺少 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET')
}

async function createStore() {
  const { archiveKey, createObjectStore, readCredentials } = await import('@scripts/lib/object-storage.ts')
  loadEnvFile({ config: devkit })
  const credentials = readCredentials()
  if (!credentials)
    return null
  const client = createObjectStore(credentials)
  return {
    put: (datasetId: string, videoId: string, pack: StreamDatapack) =>
      client.put(archiveKey(datasetId, videoId), JSON.stringify(pack)),
  }
}

interface Target {
  source: DatasetSource
  videoId: string
  packPath: string
  pack: StreamDatapack
}

function explicitIds(): string[] {
  if (!values.ids)
    return []
  return readFileSync(resolve(values.ids), 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^[A-Za-z0-9_-]{11}$/.test(line))
}

function collectTargets(): Target[] {
  const ids = new Set(explicitIds())
  const targets: Target[] = []
  for (const source of selected) {
    const dir = resolve(APP_ROOT, source.datapackDir)
    if (!existsSync(dir))
      continue
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.datapack.json'))
        continue
      const videoId = name.slice(0, -'.datapack.json'.length)
      if (ids.size > 0 && !ids.has(videoId))
        continue
      const packPath = join(dir, name)
      let pack: StreamDatapack
      try {
        pack = readJson<StreamDatapack>(packPath)
      }
      catch {
        continue
      }
      if (!values.force && Array.isArray(pack.chat?.memberChats))
        continue
      targets.push({ source, videoId, packPath, pack })
    }
  }
  return limit > 0 ? targets.slice(0, limit) : targets
}

/** 目录名以 `_<videoId>` 结尾；只建一次索引。 */
function sessionIndex(): Map<string, string> {
  const map = new Map<string, string>()
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.'))
      continue
    const match = /_([A-Za-z0-9_-]{11})$/.exec(entry.name)
    if (match && !map.has(match[1]!))
      map.set(match[1]!, join(root, entry.name))
  }
  return map
}

function readRecords(dir: string): ChatRecord[] {
  if (!existsSync(dir))
    return []
  const name = readdirSync(dir).find(file => ANY_DANMAKU_RE.test(file))
  if (!name)
    return []
  const records: ChatRecord[] = []
  for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
    if (!line.trim())
      continue
    try {
      const record = JSON.parse(line) as ChatRecord
      if (record?.msg)
        records.push(record)
    }
    catch {
      // 单行损坏不影响其余记录。
    }
  }
  return records
}

const sessions = sessionIndex()
const targets = collectTargets()
if (targets.length === 0) {
  console.log('[member-chats] 没有需要处理的场次')
  process.exit(0)
}

console.log(`[member-chats] 目标 ${targets.length} 场${upload ? '（含上传）' : '（仅本地）'}，root=${root}`)
for (const target of targets.slice(0, 10))
  console.log(`[member-chats]   ${target.source.id}/${target.videoId}`)
if (targets.length > 10)
  console.log(`[member-chats]   …另有 ${targets.length - 10} 场`)
if (dryRun)
  process.exit(0)

let ok = 0
let unchanged = 0
let missingSession = 0
let failed = 0
const failures: string[] = []

for (const target of targets) {
  const label = `${target.source.id}/${target.videoId}`
  const session = sessions.get(target.videoId)
  if (!session) {
    missingSession += 1
    console.log(`[member-chats] - ${label} 找不到会话目录，跳过`)
    continue
  }
  try {
    const records = readRecords(join(session, 'danmaku'))
    if (records.length === 0) {
      missingSession += 1
      console.log(`[member-chats] - ${label} 没有 danmaku jsonl，跳过`)
      continue
    }
    const timed = records
      .map(record => ({ record, at: chatTimestamp(record) }))
      .filter((entry): entry is { record: ChatRecord, at: number } => entry.at != null)
      .sort((a, b) => a.at - b.at)
    const chats = collectMemberChats(
      timed,
      memberChannelMap(config.datasets, target.pack.video?.channelId ?? null),
    )

    if (JSON.stringify(chats) === JSON.stringify(target.pack.chat.memberChats ?? [])) {
      unchanged += 1
      continue
    }
    target.pack.chat.memberChats = chats
    writeFileSync(target.packPath, `${JSON.stringify(target.pack, null, 2)}\n`, 'utf8')
    if (store)
      await store.put(target.source.id, target.videoId, target.pack)
    ok += 1
    console.log(`[member-chats] ✓ ${label} ${chats.length} 条${store ? ' → S3' : ''}`)
  }
  catch (error) {
    failed += 1
    const message = error instanceof Error ? error.message : String(error)
    failures.push(`${label}: ${message}`)
    console.error(`[member-chats] ✗ ${label} ${message}`)
  }
}

console.log(`[member-chats] 完成：更新 ${ok} / 无变化 ${unchanged} / 缺会话 ${missingSession} / 失败 ${failed}`)
if (failures.length > 0) {
  console.error('[member-chats] 失败列表：')
  for (const item of failures)
    console.error(`  - ${item}`)
  process.exitCode = 1
}
