/**
 * 校验 v2 数据与发布结果。
 *
 *   bun run ymmt validate content             # 只查本地 pack / insights / authors.json
 *   bun run ymmt validate content --remote    # 再对比对象存储上的实际内容
 *   bun run ymmt validate content --dataset nonoka
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
 *   - 抽一场 v2 pack 检查远端 schema（优先 `archive/`，兼容旧的 `<dataset>/`）
 *   - manifest.count 与本地 pack 数一致
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Option } from 'commander'
import { canonicalWord, isNoiseWord, isStopword } from '@/lib/words.ts'
import { archiveKey, createObjectStore, readCredentials, remoteBase } from '@scripts/lib/object-storage.ts'
import { type CommandSpec, ConfigError, createLogger, type Logger } from '@chilfish/devkit/cli'

// 文件在 scripts/commands/validate/，仓库根在上三级。
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const DATA = join(APP_ROOT, 'data')
const V2 = 'yumemita.stream-datapack/v2'

export interface VerifyContentOptions {
  remote?: boolean
  /** 只校验这些 dataset；空 = 全部。 */
  datasets?: string[]
  log?: Logger
}

export interface VerifyContentData {
  datasets: string[]
  remote: boolean
  failures: Failure[]
  notes: string[]
}

interface Failure { name: string, detail: string }

export interface VerifyContentResult {
  exitCode: number
  data: VerifyContentData
}

/** 校验用到的 pack 形状；外部 JSON 先断言再读，缺字段时按 `undefined` 处理。 */
interface PackChat {
  total?: number
  uniqueAuthors?: number
  wordCounts?: Record<string, number>
  topWords?: { word: string, count: number }[]
  authors?: { authorId?: string | null, author: string, messages: number }[]
  topAuthors?: { authorId?: string | null, author: string, messages: number }[]
}

interface PackFile {
  schema?: string
  video?: { id?: string }
  chat?: PackChat
}

interface InsightsTotals {
  topWords?: { word: string, count: number }[]
  topAuthors?: { authorId?: string | null, author: string, messages: number }[]
  aggregation?: { words?: string, authors?: string, coverage?: { words?: number, authors?: number, total?: number } }
}

interface AuthorIndex {
  authors: { id?: string | null, name: string }[]
  streams: { authors: number[] }[]
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

/**
 * 业务主体：本地自洽检查，`remote` 为真时再对照对象存储。
 *
 * 结论全部落在返回值的 `data.failures` 里；有失败项时退出码 1（不抛错，避免中间崩掉丢报告）。
 */
export async function runVerifyContent(options: VerifyContentOptions): Promise<VerifyContentResult> {
  const log = options.log ?? createLogger({ name: 'validate.content' })
  const failures: Failure[] = []
  const notes: string[] = []
  const check = (name: string, ok: boolean, detail: string): void => {
    if (!ok)
      failures.push({ name, detail })
  }

  const all = readdirSync(DATA, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'missing-danmaku')
    .map(entry => entry.name)
    .sort()
  const selected = options.datasets ?? []
  const datasets = selected.length > 0
    ? all.filter(id => selected.includes(id))
    : all

  let store: ReturnType<typeof createObjectStore> | null = null
  if (options.remote) {
    const credentials = readCredentials()
    store = credentials ? createObjectStore(credentials) : null
    if (!store && !remoteBase()) {
      throw new ConfigError('--remote 需要 R2_* 凭据、DATAPACK_BASE 或 LOCAL=1', {
        code: 'MISSING_REMOTE_CONFIG',
        hint: '在 .dev.vars 里配置 R2_* / DATAPACK_BASE，或设 LOCAL=1 走本机 SILO；只查本地就去掉 --remote',
      })
    }
  }

  const readRemote = async (key: string): Promise<string | null> => {
    if (store)
      return await store.get(key)
    const base = remoteBase()
    if (!base)
      return null
    const response = await fetch(`${base}/${key}?t=${Date.now()}`, { headers: { Accept: 'application/json' } })
    return response.ok ? await response.text() : null
  }

  for (const ds of datasets) {
    const dir = join(DATA, ds)
    const packFiles = readdirSync(dir).filter(name => name.endsWith('.datapack.json'))
    const packs = packFiles.map((name) => {
      const pack = JSON.parse(readFileSync(join(dir, name), 'utf8')) as PackFile
      return { name, pack }
    })
    const v2 = packs.filter(item => item.pack.schema === V2)
    const v1 = packs.length - v2.length
    const insights = parse<{ totals?: InsightsTotals }>(readFileSync(join(dir, 'insights.json'), 'utf8'))?.totals

    let badSum = 0
    let badUnique = 0
    const wordTotals = new Map<string, number>()
    const authorTotals = new Map<string, { messages: number }>()

    for (const { pack } of packs) {
      const chat: PackChat = pack.chat ?? {}
      if (chat.wordCounts) {
        for (const [word, count] of Object.entries(chat.wordCounts)) {
          if (isStopword(word) || isNoiseWord(word))
            continue
          if (typeof count !== 'number') continue
          const key = canonicalWord(word)
          wordTotals.set(key, (wordTotals.get(key) ?? 0) + count)
        }
      }
      else {
        for (const word of chat.topWords ?? []) {
          if (isStopword(word.word) || isNoiseWord(word.word))
            continue
          const key = canonicalWord(word.word)
          wordTotals.set(key, (wordTotals.get(key) ?? 0) + word.count)
        }
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
        for (const author of chat.topAuthors ?? []) {
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
      const index = JSON.parse(readFileSync(authorsPath, 'utf8')) as AuthorIndex
      const seen = new Set<string>()
      let duplicates = 0
      for (const author of index.authors) {
        const key = author.id ? `id:${author.id}` : `name:${author.name}`
        if (seen.has(key))
          duplicates += 1
        seen.add(key)
      }
      const badIndex = index.streams.some(stream => stream.authors.some(i => i < 0 || i >= index.authors.length))
      check(`${ds}: authors.json 去重`, duplicates === 0, `${duplicates} 个重复作者`)
      check(`${ds}: authors.json 下标`, !badIndex, '存在越界下标')
      check(`${ds}: authors.json 场次`, index.streams.length === packs.length, `${index.streams.length} != ${packs.length}`)
    }
    else if (v1 === 0) {
      check(`${ds}: authors.json`, false, '全量 v2 但没有生成 authors.json')
    }

    const sample = v2[0]?.pack.video?.id ?? null
    if (options.remote) {
      const remoteInsights = parse<{ totals?: InsightsTotals }>(await readRemote(`${ds}/insights.json`))?.totals
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
        const localIndex = JSON.parse(readFileSync(authorsPath, 'utf8')) as AuthorIndex
        check(
          `${ds}: 远端 authors.json`,
          !!remoteAuthors && remoteAuthors.authors?.length === localIndex.authors.length && remoteAuthors.streams?.length === localIndex.streams.length,
          remoteAuthors ? `${remoteAuthors.authors?.length}/${remoteAuthors.streams?.length} vs 本地 ${localIndex.authors.length}/${localIndex.streams.length}` : '缺失',
        )
      }

      if (sample) {
        // publish 只把 pack 归档到 archive/；旧路径只用于迁移前的远端数据。
        const archived = await readRemote(archiveKey(ds, sample))
        const remotePack = parse<{ schema?: string }>(
          archived ?? await readRemote(`${ds}/${sample}.datapack.json`),
        )
        check(`${ds}: 远端 pack`, remotePack?.schema === V2, `${sample} schema=${remotePack?.schema ?? 'missing'}`)
      }
    }

    const status = failures.some(failure => failure.name.startsWith(`${ds}:`)) ? 'FAIL' : 'OK'
    const agg = insights?.aggregation
    notes.push(`${status.padEnd(4)} ${ds}: v2=${v2.length} v1=${v1} aggregation=${agg ? `${agg.words}/${agg.authors}` : '-'} cohort=${agg?.coverage ? `${agg.coverage.words}/${agg.coverage.total}` : '-'}`)
  }

  for (const note of notes)
    log.info(note)

  const remoteNote = options.remote ? '，含远端' : ''
  if (failures.length === 0) {
    log.info(`ALL CHECKS PASS（${datasets.length} 个 dataset${remoteNote}）`)
    return { exitCode: 0, data: { datasets, remote: options.remote === true, failures, notes } }
  }

  log.error(`${failures.length} 项失败：`)
  for (const failure of failures)
    log.error(`  - ${failure.name}: ${failure.detail}`)
  return { exitCode: 1, data: { datasets, remote: options.remote === true, failures, notes } }
}

export const validateContentSpec: CommandSpec = {
  id: 'validate.content',
  description: '校验 v2 数据自洽（authors / insights / authors.json）并可对照远端对象',
  details: '本地检查 pack 与 insights 的字段级一致性；加 `--remote` 再对比对象存储上的实际内容。\n'
    + '整站对账以 `db verify` 为准，这里只保证发布产物自洽。',
  examples: [
    'bun run ymmt validate content',
    'bun run ymmt validate content --remote',
    'bun run ymmt validate content --dataset nonoka --json',
  ],
  options: [
    new Option('--remote', '额外对比对象存储上的 insights / manifest / authors.json / pack'),
    new Option('--dataset <id...>', '只校验指定 dataset（可重复，也可一次给多个）'),
  ],
  async run(ctx) {
    const datasets = ctx.options.dataset
    const result = await runVerifyContent({
      remote: ctx.flag('remote'),
      datasets: Array.isArray(datasets)
        ? datasets.filter((item): item is string => typeof item === 'string')
        : typeof datasets === 'string' ? [datasets] : [],
      log: ctx.log,
    })
    return { exitCode: result.exitCode, data: result.data }
  },
}
