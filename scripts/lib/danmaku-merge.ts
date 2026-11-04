/**
 * 弹幕 NDJSON 合并：把实时采集（`danmaku_live_<videoId>.jsonl`）与
 * yt-dlp 回放（`danmaku_<videoId>.jsonl`）合成一份。
 *
 * 两份数据覆盖的时间段重叠（实时采集从等待室开始，回放也包含开播前弹幕），
 * 所以必须按消息 id 去重，而不是简单拼接。去重键：
 * - 优先 `rendererId`（renderer.id，实时与回放对同一条消息给同一个 id）；
 * - 旧档没有 id 时退回 `timestampUs + authorId/author + kind + text + header`。
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
  const msg = record.msg ?? {}
  const stamp = msg.timestampUs != null ? text(msg.timestampUs) : `ts:${text(record.ts)}`
  return `raw:${stamp}|${text(msg.authorId)}|${text(msg.author)}|${text(msg.kind)}|${text(msg.text)}|${text(msg.header)}`
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
  const seen = new Set<string>()
  const records: Record<string, unknown>[] = []
  let duplicates = 0
  for (const input of inputs) {
    for (const record of input) {
      const key = danmakuKey(record)
      if (seen.has(key)) {
        duplicates += 1
        continue
      }
      seen.add(key)
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
