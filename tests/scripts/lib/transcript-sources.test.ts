import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectTranscriptSources,
  datasetFromPath,
  datasetLabelIndex,
  isIgnoredTranscriptName,
} from '@scripts/lib/transcript-sources'

const roots: string[] = []

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ymmt-transcripts-'))
  roots.push(root)
  return root
}

function write(path: string, content = ''): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const datasets = [
  { id: 'nonoka', label: '宮永ののか' },
  { id: 'arale', label: '仲町あられ' },
]

describe('isIgnoredTranscriptName', () => {
  it('跳过草稿、隐藏文件与配信一览', () => {
    expect(isIgnoredTranscriptName('_draft.md')).toBe(true)
    expect(isIgnoredTranscriptName('.template.md')).toBe(true)
    expect(isIgnoredTranscriptName('00_配信一览.md')).toBe(true)
    expect(isIgnoredTranscriptName('01_频道全量清单.md')).toBe(true)
    expect(isIgnoredTranscriptName('2026-11-11_直播.md')).toBe(false)
  })
})

describe('collectTranscriptSources', () => {
  it('成员目录只取 配信/*.md，忽略顶层档案与 raw', () => {
    const root = makeRoot()
    write(join(root, '宮永ののか', '配信', '2026-11-11_A.md'))
    write(join(root, '宮永ののか', '配信', '00_配信一览.md'))
    write(join(root, '宮永ののか', '00_个人档案.md'))
    write(join(root, '宮永ののか', 'raw', 'x.ja.fixed.txt'))

    const files = collectTranscriptSources(join(root, '宮永ののか'))
    expect(files.map(file => file.split(/[\\/]/).pop())).toEqual(['2026-11-11_A.md'])
  })

  it('团体目录取顶层 *.md，忽略 raw', () => {
    const root = makeRoot()
    write(join(root, '団体配信', '2026-11-13_B.md'))
    write(join(root, '団体配信', '00_配信一览.md'))
    write(join(root, '団体配信', 'raw', 'appendix.md'))

    const files = collectTranscriptSources(join(root, '団体配信'))
    expect(files.map(file => file.split(/[\\/]/).pop())).toEqual(['2026-11-13_B.md'])
  })

  it('成员根目录递归发现成员与团体稿件', () => {
    const root = makeRoot()
    write(join(root, '宮永ののか', '配信', 'a.md'))
    write(join(root, '仲町あられ', '配信', 'b.md'))
    write(join(root, '団体配信', 'c.md'))
    write(join(root, '団体配信', 'raw', 'd.md'))

    const names = collectTranscriptSources(root)
      .map(file => file.split(/[\\/]/).pop())
      .sort()
    expect(names).toEqual(['a.md', 'b.md', 'c.md'])
  })

  it('直接传单个文件原样返回', () => {
    const root = makeRoot()
    const file = join(root, 'x.md')
    write(file)
    expect(collectTranscriptSources(file)).toEqual([file])
  })
})

describe('datasetFromPath', () => {
  const index = datasetLabelIndex(datasets)

  it('按最近的成员目录推断', () => {
    expect(datasetFromPath('/archives/members/宮永ののか/配信/a.md', index)).toBe('nonoka')
    expect(datasetFromPath('/archives/members/仲町あられ/配信/a.md', index)).toBe('arale')
  })

  it('团体配信不在成员目录下时返回 null', () => {
    expect(datasetFromPath('/archives/members/団体配信/a.md', index)).toBeNull()
  })

  it('也接受 dataset id 作为目录名', () => {
    expect(datasetFromPath('/tmp/nonoka/a.md', index)).toBe('nonoka')
  })
})
