import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  danmakuKey,
  danmakuKeys,
  loadDanmakuFile,
  mergeDanmakuFiles,
  mergeDanmakuRecords,
  parseDanmakuText,
} from './danmaku-merge.ts'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'danmaku-merge-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe('danmakuKey', () => {
  it('优先用 rendererId', () => {
    expect(danmakuKey({ rendererId: 'CH1', msg: { text: 'a' } })).toBe('id:CH1')
  })

  it('没有 id 时退回时间戳与内容', () => {
    const a = danmakuKey({ ts: 5, msg: { timestampUs: '123', authorId: 'UC1', kind: 'text', text: 'hi' } })
    const b = danmakuKey({ ts: 999, msg: { timestampUs: '123', authorId: 'UC1', kind: 'text', text: 'hi' } })
    expect(a).toBe(b)
  })
})

describe('parseDanmakuText', () => {
  it('坏行计数并跳过', () => {
    const { records, invalid } = parseDanmakuText('{"seq":1}\nnot-json\n\n[1,2]\n{"seq":2}\n')
    expect(records).toHaveLength(2)
    expect(invalid).toBe(2)
  })
})

describe('mergeDanmakuRecords', () => {
  const replay = [
    { seq: 1, ts: 100, rendererId: 'R1', msg: { text: 'a' } },
    { seq: 2, ts: 120, rendererId: 'R2', msg: { text: 'b' } },
  ]
  const live = [
    { seq: 1, ts: 50, rendererId: 'R0', msg: { text: 'pre' } },
    { seq: 2, ts: 100, rendererId: 'R1', msg: { text: 'a' } },
    { seq: 3, ts: 130, rendererId: 'R3', msg: { text: 'c' } },
  ]

  it('按 id 去重、按 ts 排序并重编 seq', () => {
    const { records, duplicates } = mergeDanmakuRecords([replay, live])
    expect(duplicates).toBe(1)
    expect(records.map(record => record.rendererId)).toEqual(['R0', 'R1', 'R2', 'R3'])
    expect(records.map(record => record.seq)).toEqual([1, 2, 3, 4])
  })

  it('没有 rendererId 时按内容去重', () => {
    const a = { ts: 10, msg: { timestampUs: '777', author: '@a', kind: 'text', text: 'hello' } }
    const b = { ts: 10, msg: { timestampUs: '777', author: '@a', kind: 'text', text: 'hello' } }
    const { records, duplicates } = mergeDanmakuRecords([[a], [b]])
    expect(records).toHaveLength(1)
    expect(duplicates).toBe(1)
  })

  it('旧档没有 id、新回放有 id 时也能按内容键去重', () => {
    const old = { ts: 10, msg: { timestampUs: '777', author: '@a', kind: 'text', text: 'hello' } }
    const fresh = { ts: 10, rendererId: 'NEW1', msg: { timestampUs: '777', author: '@a', kind: 'text', text: 'hello' } }
    const { records, duplicates } = mergeDanmakuRecords([[old], [fresh]])
    expect(records).toHaveLength(1)
    expect(records[0]).toBe(old)
    expect(duplicates).toBe(1)
  })

  it('danmakuKeys 同时给出 id 与内容键', () => {
    expect(danmakuKeys({
      ts: 10,
      rendererId: 'R1',
      msg: { timestampUs: '777', author: '@a', kind: 'text', text: 'hello' },
    })).toEqual([
      'id:R1',
      'raw:777||@a|text|hello|',
    ])
  })

  it('同秒同作者同正文但 id 不同，不算重复', () => {
    const a = { ts: 10, rendererId: 'A', msg: { author: '@a', kind: 'text', text: '' } }
    const b = { ts: 10, rendererId: 'B', msg: { author: '@a', kind: 'text', text: '' } }
    const { records, duplicates } = mergeDanmakuRecords([[a], [b]])
    expect(records).toHaveLength(2)
    expect(duplicates).toBe(0)
  })
})

describe('mergeDanmakuFiles', () => {
  it('合并两份文件并写回输出', () => {
    const dir = tempDir()
    const replayPath = join(dir, 'danmaku_vid.jsonl')
    const livePath = join(dir, 'danmaku_live_vid.jsonl')
    const outPath = join(dir, 'merged.jsonl')
    writeFileSync(replayPath, [
      { seq: 1, ts: 100, rendererId: 'R1', msg: { text: 'a' } },
      { seq: 2, ts: 120, rendererId: 'R2', msg: { text: 'b' } },
    ].map(row => JSON.stringify(row)).join('\n'), 'utf8')
    writeFileSync(livePath, [
      { seq: 1, ts: 50, rendererId: 'R0', msg: { text: 'pre' } },
      { seq: 2, ts: 100, rendererId: 'R1', msg: { text: 'a' } },
      'broken-line',
    ].map(row => (typeof row === 'string' ? row : JSON.stringify(row))).join('\n'), 'utf8')

    const stats = mergeDanmakuFiles([replayPath, livePath], outPath)
    expect(stats).toMatchObject({ before: 2, after: 3, added: 1, duplicates: 1, invalid: 1 })
    const written = loadDanmakuFile(outPath)
    expect(written.records.map(record => record.rendererId)).toEqual(['R0', 'R1', 'R2'])
    expect(readFileSync(outPath, 'utf8').endsWith('\n')).toBe(true)
  })
})
