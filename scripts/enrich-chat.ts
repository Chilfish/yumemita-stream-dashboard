#!/usr/bin/env bun
/**
 * 用补抓到的 danmaku jsonl 把现有 v1 datapack 的 chat 聚合升级成 v2。
 *
 *   bun scripts/enrich-chat.ts
 *   bun scripts/enrich-chat.ts --dataset arale --dry-run
 *
 * 只重算弹幕相关的聚合字段（作者、词频、徽章、构成等），保留 pack 里的
 * video / vstats / comments / density / paid 等原有数据，不重新抓任何素材。
 *
 * 找不到 jsonl 的场次保持 v1；chat.total 为 0 的场次直接升级为 v2 空字段。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')

const { values } = parseArgs({
  options: {
    dataset: { type: 'string', multiple: true },
    root: { type: 'string' },
    limit: { type: 'string', default: '0' },
    force: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})

const USAGE = `用法：bun scripts/enrich-chat.ts [选项]

把已有 v1 datapack 的 chat 聚合升级为 v2（作者 / 词频全量）。

选项：
  --dataset <id>   只处理指定 dataset，可重复
  --root <目录>    原始会话根目录（默认 $STREAM_SESSION_ROOT）
  --limit <n>      本次最多处理 n 场，0 = 全部
  --force          已是 v2 也用 jsonl 重新聚合（回填 authorId 后需要）
  --dry-run        只统计，不写文件
  -h, --help       显示本帮助`

if (values.help) {
  console.log(USAGE)
  process.exit(0)
}

interface DatasetSource {
  id: string
  label: string
  datapackDir: string
}

interface ChatMsg {
  author?: string
  authorId?: string
  text?: string
  kind?: string
  badges?: string[]
  emoji?: { id: string }[]
  timestampUs?: string | number
}

interface ChatRecord {
  seq?: number
  ts?: number
  msg: ChatMsg
}

interface Pack {
  schema: string
  video?: { id?: string }
  chat?: {
    total?: number
    byKind?: Record<string, number>
    pureEmojiOnly?: number
    uniqueAuthors?: number
    ownerMessages?: number
    badges?: Record<string, number>
    topAuthors?: unknown[]
    topWords?: unknown[]
    authors?: unknown[]
    wordCounts?: Record<string, number>
    [key: string]: unknown
  }
  [key: string]: unknown
}

const V2 = 'yumemita.stream-datapack/v2'
const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { datasets: DatasetSource[] }
const selected = values.dataset && values.dataset.length > 0
  ? config.datasets.filter(source => values.dataset!.includes(source.id))
  : config.datasets
const limit = Math.max(0, Number(values.limit) || 0)

const root = resolve(values.root ?? process.env.STREAM_SESSION_ROOT ?? '')
if (!root || !existsSync(root)) {
  console.error('[enrich] 请用 --root 指定归档的会话根目录（或设置 STREAM_SESSION_ROOT）')
  process.exit(1)
}

const SEGMENTER = new Intl.Segmenter('ja', { granularity: 'word' })
const INFORMATIVE_RE = /[\p{Script=Han}\p{Script=Katakana}A-Za-z]/u
const CHANNEL_EMOJI_RE = /\[表情(?:×\d+)?\]/g

function chatTimestamp(record: ChatRecord): number | null {
  const us = record.msg.timestampUs
  if (us != null) {
    const value = Number(us) / 1_000_000
    if (Number.isFinite(value))
      return value
  }
  return typeof record.ts === 'number' ? record.ts : null
}

function isEmojiOnly(msg: ChatMsg): boolean {
  const content = (msg.text ?? '').replace(/\r?\n/g, ' ')
  const tokens = (msg.emoji ?? []).map(emoji => (emoji.id.includes('/') ? '[表情]' : emoji.id)).join('')
  const body = `${content}${tokens}`.trim()
  return body.length > 0 && body.replace(CHANNEL_EMOJI_RE, '') === ''
}

function countWords(texts: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const text of texts) {
    for (const segment of SEGMENTER.segment(text)) {
      const word = segment.segment.trim()
      if (!segment.isWordLike || word.length < 2)
        continue
      if (!(INFORMATIVE_RE.test(word) || word.length >= 4))
        continue
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
  }
  return counts
}

function topWords(counts: Map<string, number>, limitWords = 40): { word: string, count: number }[] {
  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limitWords)
    .map(([word, count]) => ({ word, count }))
}

/** 目录名以 `_<videoId>` 结尾，只建一次索引。 */
function buildSessionIndex(): Map<string, string> {
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

const sessions = buildSessionIndex()

function jsonlPathFor(videoId: string): string | null {
  const session = sessions.get(videoId)
  if (!session)
    return null
  const path = join(session, 'danmaku', `danmaku_${videoId}.jsonl`)
  return existsSync(path) ? path : null
}

interface AuthorEntry {
  author: string
  authorId: string | null
  messages: number
  superchats: number
  stickers: number
  memberships: number
  badges: Set<string>
}

function rebuildChat(records: ChatRecord[]) {
  const timed = records
    .map(record => ({ record, at: chatTimestamp(record) }))
    .filter((entry): entry is { record: ChatRecord, at: number } => entry.at != null)

  const byKind: Record<string, number> = { text: 0, superchat: 0, sticker: 0, membership: 0 }
  const authors = new Map<string, AuthorEntry>()
  const badges = new Map<string, number>()
  let pureEmojiOnly = 0
  let ownerMessages = 0

  for (const { record } of timed) {
    const msg = record.msg
    const kind = (msg.kind ?? 'text') as keyof typeof byKind
    if (kind in byKind)
      byKind[kind] += 1

    const name = msg.author ?? '(unknown)'
    const key = msg.authorId ? `id:${msg.authorId}` : `name:${name}`
    const entry = authors.get(key) ?? {
      author: name,
      authorId: msg.authorId ?? null,
      messages: 0,
      superchats: 0,
      stickers: 0,
      memberships: 0,
      badges: new Set<string>(),
    }
    entry.author = name
    entry.messages += 1
    if (kind === 'superchat')
      entry.superchats += 1
    if (kind === 'sticker')
      entry.stickers += 1
    if (kind === 'membership')
      entry.memberships += 1
    for (const badge of msg.badges ?? []) {
      badges.set(badge, (badges.get(badge) ?? 0) + 1)
      entry.badges.add(badge)
      if (badge === 'Owner')
        ownerMessages += 1
    }
    authors.set(key, entry)

    if (isEmojiOnly(msg))
      pureEmojiOnly += 1
  }

  const authorList = [...authors.values()].sort((a, b) => b.messages - a.messages)
  const wordCounts = countWords(timed.map(({ record }) => record.msg.text ?? ''))

  return {
    total: timed.length,
    byKind,
    pureEmojiOnly,
    uniqueAuthors: authorList.length,
    ownerMessages,
    badges: Object.fromEntries([...badges.entries()].sort((a, b) => b[1] - a[1])),
    topAuthors: authorList.slice(0, 20).map(entry => ({
      author: entry.author,
      authorId: entry.authorId,
      messages: entry.messages,
      superchats: entry.superchats,
      stickers: entry.stickers,
      memberships: entry.memberships,
      badges: [...entry.badges],
    })),
    authors: authorList.map(entry => ({
      author: entry.author,
      authorId: entry.authorId,
      messages: entry.messages,
      superchats: entry.superchats,
      stickers: entry.stickers,
      memberships: entry.memberships,
    })),
    topWords: topWords(wordCounts),
    wordCounts: Object.fromEntries(
      [...wordCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    ),
  }
}

let enriched = 0
let upgradedEmpty = 0
let missingRaw = 0
let alreadyV2 = 0
let failed = 0
let processed = 0

for (const source of selected) {
  const dir = join(APP_ROOT, source.datapackDir)
  if (!existsSync(dir))
    continue
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.datapack.json'))
      continue
    if (limit > 0 && processed >= limit)
      break
    const path = join(dir, name)
    let pack: Pack
    try {
      pack = JSON.parse(readFileSync(path, 'utf8')) as Pack
    }
    catch (error) {
      failed += 1
      console.error(`[enrich] ${source.id}/${name} 读取失败：${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (pack.schema === V2 && !values.force) {
      alreadyV2 += 1
      continue
    }

    const videoId = pack.video?.id ?? name.replace(/\.datapack\.json$/, '')
    const total = pack.chat?.total ?? 0
    if (total === 0) {
      if (!values['dry-run']) {
        pack.schema = V2
        pack.chat = { ...(pack.chat ?? {}), authors: [], wordCounts: {} }
        writeFileSync(path, `${JSON.stringify(pack, null, 2)}\n`, 'utf8')
      }
      upgradedEmpty += 1
      processed += 1
      continue
    }

    const jsonl = jsonlPathFor(videoId)
    if (!jsonl) {
      missingRaw += 1
      continue
    }

    try {
      const records: ChatRecord[] = []
      for (const line of readFileSync(jsonl, 'utf8').split('\n')) {
        if (!line.trim())
          continue
        try {
          const record = JSON.parse(line) as ChatRecord
          if (record?.msg)
            records.push(record)
        }
        catch {
          continue
        }
      }
      const chat = rebuildChat(records)
      if (!values['dry-run']) {
        pack.schema = V2
        pack.chat = { ...(pack.chat ?? {}), ...chat }
        writeFileSync(path, `${JSON.stringify(pack, null, 2)}\n`, 'utf8')
      }
      enriched += 1
      processed += 1
      if (processed % 50 === 0)
        console.log(`[enrich] 已处理 ${processed} 场（新增 ${enriched} / 空场次 ${upgradedEmpty}）`)
    }
    catch (error) {
      failed += 1
      console.error(`[enrich] ${source.id}/${videoId} 失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

console.log(`[enrich] 完成：升级 ${enriched} / 空场次 ${upgradedEmpty} / 缺 jsonl ${missingRaw} / 已是 v2 ${alreadyV2} / 失败 ${failed}`)
if (missingRaw > 0)
  console.log('[enrich] 缺 jsonl 的场次仍是 v1；先跑 fetch:danmaku 再重跑本脚本')
