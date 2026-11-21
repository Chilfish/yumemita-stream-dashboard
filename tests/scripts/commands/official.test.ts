import { describe, expect, it } from 'vitest'
import {
  resolveOfficialDataset,
  resolveParticipantArgs,
} from '@scripts/lib/official-stage.ts'

const DATASETS = [
  { id: 'nonoka', label: '宮永ののか', manifest: '', datapackDir: '' },
  { id: 'arale', label: '仲町あられ', manifest: '', datapackDir: '' },
  { id: 'ritsu', label: '峰月律', manifest: '', datapackDir: '' },
  { id: 'miyako', label: '藤都子', manifest: '', datapackDir: '' },
  { id: 'yuno', label: '千石ユノ', manifest: '', datapackDir: '' },
  { id: 'other', label: '其他联动', kind: 'official' as const, manifest: '', datapackDir: '' },
]

describe('resolveParticipantArgs', () => {
  it('all 展开为全部成员', () => {
    expect(resolveParticipantArgs(['all'], DATASETS)).toEqual([
      'nonoka',
      'arale',
      'ritsu',
      'miyako',
      'yuno',
    ])
  })

  it('支持逗号分隔与重复传入，并去重保序', () => {
    expect(resolveParticipantArgs(['yuno,arale', 'yuno'], DATASETS)).toEqual(['yuno', 'arale'])
  })

  it('未知成员直接报错，不静默丢弃', () => {
    expect(() => resolveParticipantArgs(['yono'], DATASETS)).toThrow(/未知参与者/)
  })

  it('缺少参数时报错并列出可用成员', () => {
    expect(() => resolveParticipantArgs([], DATASETS)).toThrow(/缺少 --participants/)
  })

  it('all 会排除场次归属的频道主', () => {
    expect(resolveParticipantArgs(['all'], DATASETS, { excludeId: 'yuno' })).toEqual([
      'nonoka',
      'arale',
      'ritsu',
      'miyako',
    ])
  })
})

describe('resolveOfficialDataset', () => {
  it('默认落到聚合账号 other', () => {
    expect(resolveOfficialDataset(DATASETS, undefined).id).toBe('other')
  })

  it('显式指定官方账号', () => {
    const withChannel = [
      ...DATASETS,
      { id: 'limista', label: 'リミスタ', kind: 'official' as const, manifest: '', datapackDir: '' },
    ]
    expect(resolveOfficialDataset(withChannel, 'limista').id).toBe('limista')
  })

  it('指向成员频道时拒绝', () => {
    expect(() => resolveOfficialDataset(DATASETS, 'nonoka')).toThrow(/是成员频道/)
  })

  it('找不到账号时报配置错误', () => {
    expect(() => resolveOfficialDataset(DATASETS, 'nope')).toThrow(/没有官方账号/)
  })
})
