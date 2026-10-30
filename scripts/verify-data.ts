#!/usr/bin/env bun
/**
 * 校验 v2 数据与发布结果。
 *
 *   bun scripts/verify-data.ts             # 只查本地 pack / insights / authors.json
 *   bun scripts/verify-data.ts --remote    # 再对比对象存储上的实际内容
 *   bun scripts/verify-data.ts --dataset nonoka
 *
 * 本地检查：
 *   - 每个 v2 pack 的 authors 发言数之和 == chat.total
 *   - authors.length == uniqueAuthors
 *   - insights 的 topWords / topAuthors 与直接从 pack 重算的结果一致
 *   - insights.aggregation.coverage 与 v2 场次数一致
 *   - authors.json 的下标有效、作者无重复、场次数与 manifest 一致
 *
 * 远端检查（--remote）：
 *   - insights.json 的 aggregation 与本地一致
 *   - 本地有 authors.json 时，远端也必须存在且内容规模一致
 *   - 抽一场 v2 pack 检查远端 schema
 *   - manifest.count 与本地 pack 数一致
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createObjectStore, readCredentials, remoteBase } from './lib/object-storage.ts'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(APP_ROOT, 'data')
const V2 = 'yumemita.stream-datapack/v2'

const { values } = parseArgs({
  options: {
    remote: { type: 'boolean' },
    dataset: { type: 'string', multiple: true },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})

if (values.help) {
  console.log('用法：bun scripts/verify-data.ts [--remote] [--dataset <id>]')
  process.exit(0)
}

interface Failure { name: string, detail: string }
const failures: Failure[] = []
const notes: string[] = []
function check(name: string, ok: boolean, detail: string): void {
  if (!ok)
    failures.push({ name, detail })
}

const all = readdirSync(DATA, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'missing-danmaku')
  .map(entry => entry.name)
  .sort()
const datasets = values.dataset && values.dataset.length > 0
  ? all.filter(id => values.dataset!.includes(id))
  : all

let store: ReturnType<typeof createObjectStore> | null = null
if (values.remote) {
  const credentials = readCredentials()
  store = credentials ? createObjectStore(credentials) : null
  if (!store && !remoteBase()) {
    console.error('[verify] --remote 需要 R2_* 凭据或 DATAPACK_BASE / VITE_DATAPACK_BASE')
    process.exit(1)
  }
}

async function readRemote(key: string): Promise<string | null> {
  if (store)
    return await store.get(key)
  const base = remoteBase()
  if (!base)
    return null
  const response = await fetch(`${base}/${key}?t=${Date.now()}`, { headers: { Accept: 'application/json' } })
  return response.ok ? await response.text() : null
}

function parse<T>(text: string | null): T | null {
  if (text == null)
    return null
  try {
    return JSON.parse(text) as T
  }
  catch {
    return null
  }
}

for (const ds of datasets) {
  const dir = join(DATA, ds)
  const packFiles = readdirSync(dir).filter(name => name.endsWith('.datapack.json'))
  const packs = packFiles.map(name => {
    const pack = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    return { name, pack }
  })
  const v2 = packs.filter(item => item.pack.schema === V2)
  const v1 = packs.length - v2.length
  const insights = parse<{ totals?: any }>(readFileSync(join(dir, 'insights.json'), 'utf8'))?.totals

  let badSum = 0
  let badUnique = 0
  const wordTotals = new Map<string, number>()
  const authorTotals = new Map<string, { messages: number }>()

  for (const { pack } of packs) {
    const chat = pack.chat
    if (chat.wordCounts) {
      for (const [word, count] of Object.entries(chat.wordCounts))
        wordTotals.set(word, (wordTotals.get(word) ?? 0) + count)
    }
    else {
      for (const word of chat.topWords)
        wordTotals.set(word.word, (wordTotals.get(word.word) ?? 0) + word.count)
    }

    if (chat.authors) {
      let sum = 0
      for (const author of chat.authors) {
        sum += author.messages
        const key = author.authorId ? `id:${author.authorId}` : `name:${author.author}`
        authorTotals.set(key, { messages: (authorTotals.get(key)?.messages ?? 0) + author.messages })
      }
      if (sum !== chat.total)
        badSum += 1
      if (chat.authors.length !== chat.uniqueAuthors)
        badUnique += 1
    }
    else {
      for (const author of chat.topAuthors) {
        const key = `name:${author.author}`
        authorTotals.set(key, { messages: (authorTotals.get(key)?.messages ?? 0) + author.messages })
      }
    }
  }

  check(`${ds}: authors 发言数之和`, badSum === 0, `${badSum} 场 authors.messages 之和 != chat.total`)
  check(`${ds}: uniqueAuthors`, badUnique === 0, `${badUnique} 场 authors.length != uniqueAuthors`)

  const topWord = [...wordTotals.entries()].sort((a, b) => b[1] - a[1])[0]
  const topAuthor = [...authorTotals.entries()].sort((a, b) => b[1].messages - a[1].messages)[0]
  const insightWord = insights?.topWords?.[0]
  const insightAuthor = insights?.topAuthors?.[0]
  check(
    `${ds}: insights 词频`,
    !!topWord && !!insightWord && topWord[0] === insightWord.word && topWord[1] === insightWord.count,
    `重算 ${topWord?.[0]}:${topWord?.[1]} vs insights ${insightWord?.word}:${insightWord?.count}`,
  )
  check(
    `${ds}: insights 发言者`,
    !!topAuthor && !!insightAuthor
      && topAuthor[0] === (insightAuthor.authorId ? `id:${insightAuthor.authorId}` : `name:${insightAuthor.author}`)
      && topAuthor[1].messages === insightAuthor.messages,
    `重算 ${topAuthor?.[0]}:${topAuthor?.[1].messages} vs insights ${insightAuthor?.author}:${insightAuthor?.messages}`,
  )
  check(
    `${ds}: aggregation 覆盖率`,
    insights?.aggregation?.coverage?.words === v2.length
      && insights?.aggregation?.coverage?.authors === v2.length
      && insights?.aggregation?.coverage?.total === packs.length,
    `insights ${JSON.stringify(insights?.aggregation?.coverage)} vs v2=${v2.length} total=${packs.length}`,
  )

  const authorsPath = join(dir, 'authors.json')
  if (existsSync(authorsPath)) {
    const index = JSON.parse(readFileSync(authorsPath, 'utf8'))
    const seen = new Set<string>()
    let duplicates = 0
    for (const author of index.authors) {
      const key = author.id ? `id:${author.id}` : `name:${author.name}`
      if (seen.has(key))
        duplicates += 1
      seen.add(key)
    }
    const badIndex = index.streams.some((stream: any) => stream.authors.some((i: number) => i < 0 || i >= index.authors.length))
    check(`${ds}: authors.json 去重`, duplicates === 0, `${duplicates} 个重复作者`)
    check(`${ds}: authors.json 下标`, !badIndex, '存在越界下标')
    check(`${ds}: authors.json 场次`, index.streams.length === packs.length, `${index.streams.length} != ${packs.length}`)
  }
  else if (v1 === 0) {
    check(`${ds}: authors.json`, false, '全量 v2 但没有生成 authors.json')
  }

  const sample = v2[0]?.pack.video?.id ?? null
  if (values.remote) {
    const remoteInsights = parse<{ totals?: any }>(await readRemote(`${ds}/insights.json`))?.totals
    check(
      `${ds}: 远端 insights`,
      JSON.stringify(remoteInsights?.aggregation) === JSON.stringify(insights?.aggregation),
      `远端 ${JSON.stringify(remoteInsights?.aggregation)} vs 本地 ${JSON.stringify(insights?.aggregation)}`,
    )

    const remoteManifest = parse<{ count?: number, streams?: unknown[] }>(await readRemote(`${ds}/manifest.json`))
    check(
      `${ds}: 远端 manifest`,
      (remoteManifest?.count ?? remoteManifest?.streams?.length ?? -1) === packs.length,
      `远端 ${remoteManifest?.count ?? 'missing'} vs 本地 ${packs.length}`,
    )

    if (existsSync(authorsPath)) {
      const remoteAuthors = parse<{ authors?: unknown[], streams?: unknown[] }>(await readRemote(`${ds}/authors.json`))
      const localIndex = JSON.parse(readFileSync(authorsPath, 'utf8'))
      check(
        `${ds}: 远端 authors.json`,
        !!remoteAuthors && remoteAuthors.authors?.length === localIndex.authors.length && remoteAuthors.streams?.length === localIndex.streams.length,
        remoteAuthors ? `${remoteAuthors.authors?.length}/${remoteAuthors.streams?.length} vs 本地 ${localIndex.authors.length}/${localIndex.streams.length}` : '缺失',
      )
    }

    if (sample) {
      const remotePack = parse<{ schema?: string }>(await readRemote(`${ds}/${sample}.datapack.json`))
      check(`${ds}: 远端 pack`, remotePack?.schema === V2, `${sample} schema=${remotePack?.schema ?? 'missing'}`)
    }
  }

  const status = failures.some(failure => failure.name.startsWith(`${ds}:`)) ? 'FAIL' : 'OK'
  const agg = insights?.aggregation
  notes.push(`${status.padEnd(4)} ${ds}: v2=${v2.length} v1=${v1} aggregation=${agg ? `${agg.words}/${agg.authors}` : '-'} cohort=${agg?.coverage ? `${agg.coverage.words}/${agg.coverage.total}` : '-'}`)
}

for (const note of notes)
  console.log(note)

if (failures.length === 0) {
  console.log(`\nALL CHECKS PASS（${datasets.length} 个 dataset${values.remote ? '，含远端' : ''}）`)
  process.exit(0)
}

console.error(`\n${failures.length} 项失败：`)
for (const failure of failures)
  console.error(`  - ${failure.name}: ${failure.detail}`)
process.exit(1)
