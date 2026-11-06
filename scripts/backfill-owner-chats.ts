#!/usr/bin/env bun
/**
 * 临时脚本：只补 `chat.ownerChats`，不重抓 meta / 评论 / VSTATS。
 *
 *   bun scripts/backfill-owner-chats.ts --dry-run
 *   bun scripts/backfill-owner-chats.ts --dataset yuno
 *   bun scripts/backfill-owner-chats.ts --dataset arale --ids ids.txt --concurrency 3
 *
 * 流程：从对象存储读 pack（读不到回退本地）→ 只下载 live_chat → 归一化 →
 * 提取 Owner 徽章记录 → 合并进 pack → 上传回对象存储 + 同步本地 data/。
 * 目标默认是「ownerMessages > 0 且还没有 ownerChats」的场次；--force 连已有的也重抓。
 *
 * 完成后可删除本脚本。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { normalizeLiveChat, type ChatRecord } from './lib/live-chat.ts'
import { archiveKey, createObjectStore, datapackKey, readCredentials } from './lib/object-storage.ts'
import { resolveCookies, ytdlpCookieArgs } from './lib/yt-cookies.ts'
import type { OwnerChat, StreamDatapack } from '../src/types/datapack.ts'

interface DatasetSource {
  id: string
  label: string
  datapackDir: string
}

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')
const JST_OFFSET_MIN = 540
const OWNER_KINDS = new Set<OwnerChat['kind']>(['text', 'superchat', 'sticker', 'membership', 'gift'])

const { values } = parseArgs({
  options: {
    dataset: { type: 'string' },
    ids: { type: 'string' },
    concurrency: { type: 'string', default: '3' },
    limit: { type: 'string', default: '0' },
    'work-dir': { type: 'string' },
    cookies: { type: 'string' },
    'cookies-from-browser': { type: 'string', default: 'firefox' },
    'cookie-cache': { type: 'string' },
    'no-cookies': { type: 'boolean' },
    force: { type: 'boolean' },
    'no-upload': { type: 'boolean' },
    'keep-raw': { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})

const USAGE = `用法：bun scripts/backfill-owner-chats.ts [选项]

只抓 live_chat，把主播本人发言明细（chat.ownerChats）补进 pack，并上传回对象存储。
默认处理「有 Owner 发言、但还没有 ownerChats」的场次。

选项：
  --dataset <id>             只处理指定 dataset
  --ids <文件>               指定 videoId 列表（每行一个），需同时指定 --dataset
  --concurrency <n>          yt-dlp 并发，默认 3
  --limit <n>                本次最多处理 n 场，0 = 全部
  --work-dir <目录>          临时下载目录，默认 ./temp/owner-chats
  --cookies <文件>           Netscape cookie jar；不传则每次运行从浏览器导出到 ~/yt-cookies.txt
  --cookies-from-browser <b> 导出 cookie 时用哪个浏览器，默认 firefox
  --cookie-cache <文件>      cookie 缓存路径，默认 ~/yt-cookies.txt
  --no-cookies               不使用 cookie，以匿名状态抓取
  --force                    已有 ownerChats 的场次也重新抓取
  --no-upload                只更新本地 pack，不上传对象存储
  --keep-raw                 保留下载的 live_chat 与 jsonl
  --dry-run                  只列出目标，不下载也不写
  -h, --help                 显示本帮助`

if (values.help) {
  console.log(USAGE)
  process.exit(0)
}

function fail(message: string): never {
  console.error(`[backfill] ${message}`)
  process.exit(1)
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function jstIso(seconds: number): string {
  const d = new Date((seconds + JST_OFFSET_MIN * 60) * 1000)
  return `${d.toISOString().slice(0, 19)}+09:00`
}

function chatTimestamp(record: ChatRecord): number | null {
  const us = record.msg.timestampUs
  if (us != null) {
    const n = Number(us) / 1_000_000
    if (Number.isFinite(n))
      return n
  }
  return typeof record.ts === 'number' ? record.ts : null
}

function ownerChatsFrom(records: ChatRecord[]): OwnerChat[] {
  const chats: OwnerChat[] = []
  for (const record of records) {
    if (!(record.msg.badges ?? []).includes('Owner'))
      continue
    const at = chatTimestamp(record)
    if (at == null)
      continue
    const rawKind = record.msg.kind ?? 'text'
    const kind = rawKind === 'giftRedemption' ? 'membership' : rawKind
    const emojis = record.msg.emoji?.map(item => item.id) ?? []
    chats.push({
      at: jstIso(at),
      kind: OWNER_KINDS.has(kind as OwnerChat['kind']) ? kind as OwnerChat['kind'] : 'text',
      text: (record.msg.text ?? '').trim() || (record.msg.header ?? '').trim(),
      ...(emojis.length ? { emojis } : {}),
    })
  }
  return chats.sort((a, b) => a.at.localeCompare(b.at))
}

function readRecords(path: string): ChatRecord[] {
  const records: ChatRecord[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
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

async function runYtdlp(args: string[]): Promise<{ code: number, stderr: string }> {
  const proc = Bun.spawn(['yt-dlp', ...args], { cwd: APP_ROOT, stdout: 'ignore', stderr: 'pipe' })
  const stderrPromise = new Response(proc.stderr).text()
  const code = await proc.exited
  return { code, stderr: await stderrPromise }
}

function isLoginWall(message: string): boolean {
  return /Sign in to confirm you.{1,3}re not a bot|Use --cookies/i.test(message)
}

function isMembersOnly(message: string): boolean {
  return /members-only|join this channel to get access/i.test(message)
}

const config = readJson<{ datasets: DatasetSource[] }>(CONFIG_PATH)
if (!Array.isArray(config.datasets) || config.datasets.length === 0)
  fail('data-sources.json 里没有 datasets')

const selected = values.dataset
  ? config.datasets.filter(source => source.id === values.dataset)
  : config.datasets
if (selected.length === 0)
  fail(`data-sources.json 里没有 dataset：${values.dataset}`)

if (values.ids && selected.length !== 1)
  fail('用 --ids 时请同时指定且只指定一个 --dataset')

const credentials = readCredentials()
if (!values['dry-run'] && !credentials && !values['no-upload'])
  fail('缺少 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET')
const store = credentials ? createObjectStore(credentials) : null

const limit = Math.max(0, Number(values.limit) || 0)
const concurrency = Math.max(1, Number(values.concurrency) || 3)
const workRoot = resolve(values['work-dir'] ?? join(APP_ROOT, 'temp', 'owner-chats'))
const resolvedCookies = await resolveCookies({
  cookies: values.cookies,
  envCookie: process.env.YT_COOKIE,
  browser: values['cookies-from-browser'],
  cachePath: values['cookie-cache'],
  disable: values['no-cookies'],
  appRoot: APP_ROOT,
  log: line => console.log(`[owner-chats] ${line}`),
})
const cookieArgs = ytdlpCookieArgs(resolvedCookies, { browser: values['cookies-from-browser'] })
const proxy = process.env.YTDLP_PROXY
const proxyArgs = proxy ? ['--proxy', proxy] : []

interface Target {
  source: DatasetSource
  videoId: string
}

function readIds(): string[] {
  if (!values.ids)
    return []
  return readFileSync(resolve(values.ids), 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^[A-Za-z0-9_-]{11}$/.test(line))
}

function collectTargets(): Target[] {
  const targets: Target[] = []
  for (const source of selected) {
    const explicit = readIds()
    if (explicit.length > 0) {
      for (const videoId of explicit)
        targets.push({ source, videoId })
      continue
    }

    const dir = resolve(APP_ROOT, source.datapackDir)
    if (!existsSync(dir))
      continue
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.datapack.json'))
        continue
      const videoId = name.slice(0, -'.datapack.json'.length)
      let pack: StreamDatapack
      try {
        pack = readJson<StreamDatapack>(join(dir, name))
      }
      catch {
        continue
      }
      if (!values.force && Array.isArray(pack.chat?.ownerChats))
        continue
      if (!values.force && !(pack.chat?.ownerMessages > 0))
        continue
      targets.push({ source, videoId })
    }
  }
  return limit > 0 ? targets.slice(0, limit) : targets
}

const targets = collectTargets()
if (targets.length === 0) {
  console.log('[backfill] 没有需要处理的场次')
  process.exit(0)
}

console.log(`[backfill] 目标 ${targets.length} 场，并发 ${concurrency}，work=${workRoot}`)
for (const target of targets.slice(0, 10))
  console.log(`[backfill]   ${target.source.id}/${target.videoId}`)
if (targets.length > 10)
  console.log(`[backfill]   …另有 ${targets.length - 10} 场`)

if (values['dry-run'])
  process.exit(0)

async function loadPack(target: Target): Promise<{ pack: StreamDatapack, from: 'remote' | 'local' } | null> {
  if (store) {
    try {
      const text = await store.get(archiveKey(target.source.id, target.videoId))
        ?? await store.get(datapackKey(target.source.id, target.videoId))
      if (text)
        return { pack: JSON.parse(text) as StreamDatapack, from: 'remote' }
    }
    catch (error) {
      console.warn(`[backfill]   ! ${target.source.id}/${target.videoId} 读取远端 pack 失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const localPath = join(resolve(APP_ROOT, target.source.datapackDir), `${target.videoId}.datapack.json`)
  if (existsSync(localPath))
    return { pack: readJson<StreamDatapack>(localPath), from: 'local' }
  return null
}

let ok = 0
let skipped = 0
let unavailable = 0
let noOwner = 0
let failed = 0
let aborted = false
const failures: string[] = []

async function processTarget(target: Target): Promise<void> {
  if (aborted)
    return
  const label = `${target.source.id}/${target.videoId}`

  const loaded = await loadPack(target)
  if (!loaded) {
    failed += 1
    failures.push(`${label}: 找不到 pack`)
    console.error(`[backfill] ✗ ${label} 找不到 pack`)
    return
  }
  const { pack, from } = loaded
  if (pack.video?.id !== target.videoId) {
    failed += 1
    failures.push(`${label}: pack.video.id=${pack.video?.id ?? '缺失'}`)
    console.error(`[backfill] ✗ ${label} pack.video.id 不匹配`)
    return
  }
  if (!values.force && Array.isArray(pack.chat.ownerChats)) {
    skipped += 1
    return
  }

  const workDir = join(workRoot, target.videoId)
  const rawPath = join(workDir, `${target.videoId}.live_chat.json`)
  const jsonlPath = join(workDir, `danmaku_${target.videoId}.jsonl`)
  mkdirSync(workDir, { recursive: true })

  try {
    const args = [
      ...cookieArgs,
      ...proxyArgs,
      '--socket-timeout', '30',
      '--retries', '3',
      '--skip-download',
      '--write-subs',
      '--sub-langs', 'live_chat',
      '-o', join(workDir, '%(id)s.%(ext)s'),
      `https://www.youtube.com/watch?v=${target.videoId}`,
    ]
    const { code, stderr } = await runYtdlp(args)
    if (code !== 0) {
      if (isLoginWall(stderr)) {
        aborted = true
        failed += 1
        failures.push(`${label}: YouTube 登录墙`)
        console.error(`[backfill] ✗ ${label} YouTube 登录墙，停止后续任务`)
        return
      }
      if (isMembersOnly(stderr)) {
        unavailable += 1
        console.log(`[backfill] - ${label} 会员限定，没有回放`)
        return
      }
      failed += 1
      failures.push(`${label}: yt-dlp exit ${code}`)
      console.error(`[backfill] ✗ ${label} yt-dlp exit ${code}：${stderr.trim().split('\n').slice(-1)[0] ?? ''}`)
      return
    }
    if (!existsSync(rawPath)) {
      unavailable += 1
      console.log(`[backfill] - ${label} 没有 live_chat 回放`)
      return
    }

    await normalizeLiveChat(rawPath, jsonlPath, target.videoId)
    const chats = ownerChatsFrom(readRecords(jsonlPath))
    if (chats.length === 0) {
      noOwner += 1
      console.log(`[backfill] - ${label} 没有 Owner 发言（原记录 ${pack.chat.ownerMessages}）`)
      return
    }

    if (pack.chat.ownerMessages !== chats.length)
      console.log(`[backfill]   ${label} ownerMessages ${pack.chat.ownerMessages} → ${chats.length}`)
    pack.chat.ownerChats = chats
    pack.chat.ownerMessages = chats.length

    if (store && !values['no-upload'])
      await store.put(archiveKey(target.source.id, target.videoId), JSON.stringify(pack))

    const localDir = resolve(APP_ROOT, target.source.datapackDir)
    mkdirSync(localDir, { recursive: true })
    writeFileSync(join(localDir, `${target.videoId}.datapack.json`), `${JSON.stringify(pack, null, 2)}\n`, 'utf8')

    ok += 1
    console.log(`[backfill] ✓ ${label} ownerChats=${chats.length}（${from}${store && !values['no-upload'] ? ' → S3' : ''}）`)
  }
  catch (error) {
    failed += 1
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    console.error(`[backfill] ✗ ${label} ${error instanceof Error ? error.message : String(error)}`)
  }
  finally {
    if (!values['keep-raw'])
      rmSync(workDir, { recursive: true, force: true })
    const done = ok + skipped + unavailable + noOwner + failed
    if (done % 20 === 0)
      console.log(`[backfill] 进度 ${done}/${targets.length}（成功 ${ok} / 跳过 ${skipped} / 失败 ${failed}）`)
  }
}

const workers = Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
  for (;;) {
    const target = targets.shift()
    if (!target || aborted)
      return
    await processTarget(target)
  }
})
await Promise.all(workers)

console.log(`[backfill] 完成：成功 ${ok} / 已有 ${skipped} / 无回放 ${unavailable} / 无 Owner ${noOwner} / 失败 ${failed}`)
if (failures.length > 0) {
  console.error('[backfill] 失败列表：')
  for (const item of failures)
    console.error(`  - ${item}`)
  process.exitCode = 1
}
