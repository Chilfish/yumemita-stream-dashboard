/**
 * 弹幕 NDJSON 合并：把实时采集（`danmaku_live_<videoId>.jsonl`）与
 * yt-dlp 回放（`danmaku_<videoId>.jsonl`）合成一份。
 *
 * 两份数据覆盖的时间段重叠（实时采集从等待室开始，回放也包含开播前弹幕），
 * 所以必须按消息 id 去重，而不是简单拼接。每条记录同时有两个去重键：
 * - `rendererId`（renderer.id，实时、InnerTube 回放与 yt-dlp 回放对同一条消息给同一个 id）；
 * - 内容键 `timestampUs + authorId/author + kind + text + header`，旧 jsonl 没有 id 时用它。
 *
 * 合并时把两个键都放进同一个集合：这样「旧档没有 id、新回放有 id」的同一条消息也能去重，
 * 不会因为一边缺 id 而重复入库。
 *
 * 输出按 `ts` 升序并重新编号 `seq`，与 `stream-datapack` 的读取口径一致。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export interface DanmakuKeySource {
  rendererId?: unknown
  ts?: unknown
  msg?: {
    timestampUs?: unknown
    authorId?: unknown
    author?: unknown
    kind?: unknown
    text?: unknown
    header?: unknown
  } | null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

export function danmakuKey(record: DanmakuKeySource): string {
  const rendererId = text(record.rendererId)
  if (rendererId)
    return `id:${rendererId}`
  return contentKey(record)
}

function contentKey(record: DanmakuKeySource): string {
  const msg = record.msg ?? {}
  const stamp = msg.timestampUs != null ? text(msg.timestampUs) : `ts:${text(record.ts)}`
  return `raw:${stamp}|${text(msg.authorId)}|${text(msg.author)}|${text(msg.kind)}|${text(msg.text)}|${text(msg.header)}`
}

/**
 * 一条记录的全部去重键：有 `rendererId` 时同时给出 id 键与内容键。
 * 旧档缺 id、新回放带 id 时，靠内容键把两边对齐。
 */
export function danmakuKeys(record: DanmakuKeySource): string[] {
  const rendererId = text(record.rendererId)
  return rendererId ? [`id:${rendererId}`, contentKey(record)] : [contentKey(record)]
}

/**
 * 跨来源去重集合。
 *
 * - 带 `rendererId` 的记录按 id 去重，同时与「没有 id 的旧记录」的内容键对齐；
 * - 没有 id 的记录只能按内容键去重。
 *
 * 不能把带 id 记录的内容键也放进集合：同一作者在同一秒发两条相同正文
 * （尤其是纯表情消息 `text: ""`）时，id 不同但内容键相同，会被误判成重复。
 */
export class DanmakuKeySet {
  private readonly ids = new Set<string>()
  private readonly bareContent = new Set<string>()

  has(record: DanmakuKeySource): boolean {
    return this.ids.has(text(record.rendererId)) || this.bareContent.has(contentKey(record))
  }

  add(record: DanmakuKeySource): void {
    if (text(record.rendererId))
      this.ids.add(text(record.rendererId))
    else
      this.bareContent.add(contentKey(record))
  }
}

function tsOf(record: Record<string, unknown>): number {
  return typeof record.ts === 'number' && Number.isFinite(record.ts) ? record.ts : 0
}

export function parseDanmakuText(source: string): { records: Record<string, unknown>[], invalid: number } {
  const records: Record<string, unknown>[] = []
  let invalid = 0
  for (const line of source.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed)
      continue
    try {
      const record = JSON.parse(trimmed) as unknown
      if (typeof record === 'object' && record !== null && !Array.isArray(record))
        records.push(record as Record<string, unknown>)
      else
        invalid += 1
    }
    catch {
      invalid += 1
    }
  }
  return { records, invalid }
}

export function loadDanmakuFile(path: string): {
  records: Record<string, unknown>[]
  invalid: number
  exists: boolean
} {
  if (!existsSync(path))
    return { records: [], invalid: 0, exists: false }
  const { records, invalid } = parseDanmakuText(readFileSync(path, 'utf8'))
  return { records, invalid, exists: true }
}

/** 按去重键合并多份记录，按 `ts` 升序重新编号 `seq`。先出现的来源优先。 */
export function mergeDanmakuRecords(
  inputs: readonly (readonly Record<string, unknown>[])[],
): { records: Record<string, unknown>[], duplicates: number } {
  const seen = new DanmakuKeySet()
  const records: Record<string, unknown>[] = []
  let duplicates = 0
  for (const input of inputs) {
    for (const record of input) {
      if (seen.has(record)) {
        duplicates += 1
        continue
      }
      seen.add(record)
      records.push(record)
    }
  }
  // Array.prototype.sort 是稳定排序：同一秒内的记录保持来源顺序。
  records.sort((a, b) => tsOf(a) - tsOf(b))
  records.forEach((record, index) => {
    record.seq = index + 1
  })
  return { records, duplicates }
}

export function writeDanmakuFile(path: string, records: readonly Record<string, unknown>[]): void {
  const body = records.map(record => JSON.stringify(record)).join('\n')
  writeFileSync(path, body ? `${body}\n` : '', 'utf8')
}

/**
 * 合并文件：`inputs` 的第一份通常是与输出相同路径的回放文件。
 * `added` = 合并后比第一份多出来的条数（实时采集补进的历史）。
 */
export function mergeDanmakuFiles(inputs: readonly string[], output: string): {
  before: number
  after: number
  added: number
  duplicates: number
  invalid: number
} {
  const sets: Record<string, unknown>[][] = []
  let invalid = 0
  for (const input of inputs) {
    const loaded = loadDanmakuFile(input)
    invalid += loaded.invalid
    sets.push(loaded.records)
  }
  const before = sets[0]?.length ?? 0
  const { records, duplicates } = mergeDanmakuRecords(sets)
  writeDanmakuFile(output, records)
  return { before, after: records.length, added: records.length - before, duplicates, invalid }
}
