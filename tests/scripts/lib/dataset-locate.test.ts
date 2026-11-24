import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findDatasetByLocalPack, packPath, readDatasets } from '@scripts/lib/dataset-locate.ts'

function fixture(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'ymmt-dataset-locate-'))
  for (const file of files) {
    const path = join(root, file)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, '{}')
  }
  writeFileSync(join(root, 'data-sources.json'), JSON.stringify({
    datasets: [
      { id: 'nonoka', label: '宮永ののか', datapackDir: 'data/nonoka', channelId: 'UCGe' },
      { id: 'other', label: '其他联动', datapackDir: 'data/other', channelId: null },
    ],
  }))
  return root
}

describe('readDatasets', () => {
  it('按 data-sources.json 顺序返回 dataset', () => {
    const root = fixture([])
    expect(readDatasets(root).map(item => item.id)).toEqual(['nonoka', 'other'])
  })

  it('缺 datasets 数组时返回空', () => {
    const root = mkdtempSync(join(tmpdir(), 'ymmt-dataset-locate-'))
    writeFileSync(join(root, 'data-sources.json'), '{}')
    expect(readDatasets(root)).toEqual([])
  })
})

describe('findDatasetByLocalPack', () => {
  it('按 pack 所在目录反查 dataset', () => {
    const root = fixture(['data/other/Jih2ArVViRo.datapack.json'])
    const datasets = readDatasets(root)
    expect(findDatasetByLocalPack(datasets, root, 'Jih2ArVViRo')?.id).toBe('other')
  })

  it('没有 pack 时返回 null，不看频道 ID', () => {
    const root = fixture(['data/nonoka/aaaaaaaaaaa.datapack.json'])
    const datasets = readDatasets(root)
    expect(findDatasetByLocalPack(datasets, root, 'Jih2ArVViRo')).toBeNull()
  })

  it('同名 pack 出现在多个 dataset 时取配置里的第一个', () => {
    const root = fixture([
      'data/nonoka/bbbbbbbbbbb.datapack.json',
      'data/other/bbbbbbbbbbb.datapack.json',
    ])
    const datasets = readDatasets(root)
    expect(findDatasetByLocalPack(datasets, root, 'bbbbbbbbbbb')?.id).toBe('nonoka')
  })

  it('packPath 拼到 datapackDir 下', () => {
    const root = fixture([])
    const [dataset] = readDatasets(root)
    expect(packPath(root, dataset, 'ccccccccccc')).toBe(
      join(root, 'data', 'nonoka', 'ccccccccccc.datapack.json'),
    )
  })
})
