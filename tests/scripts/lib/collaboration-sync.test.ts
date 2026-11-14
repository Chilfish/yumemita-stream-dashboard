import { describe, expect, it } from 'vitest'
import { planCollaborationUpdates } from '@scripts/lib/collaboration-sync'

const known = ['nonoka', 'arale', 'ritsu', 'miyako', 'yuno']

describe('planCollaborationUpdates', () => {
  it('按登记覆盖标题推断，只返回真正变化的行', () => {
    const diff = planCollaborationUpdates({
      rows: [
        { videoId: 'registered01', datasetId: 'ritsu', title: 'ユノと律の雑談', participants: [] },
        { videoId: 'registered02', datasetId: 'yuno', title: 'ひとりで歌う', participants: [] },
      ],
      manual: new Map([['registered01', ['nonoka']]]),
      knownDatasetIds: known,
    })
    expect(diff.changes).toEqual([
      { videoId: 'registered01', ownerId: 'ritsu', before: [], after: ['nonoka'], source: 'manual' },
    ])
    expect(diff.unchanged).toBe(1)
    expect(diff.affectedDatasetIds).toEqual(['nonoka', 'ritsu'])
  })

  it('未登记场次按标题推断', () => {
    const diff = planCollaborationUpdates({
      rows: [
        { videoId: 'inferred001', datasetId: 'ritsu', title: 'ユノと律の雑談', participants: [] },
      ],
      manual: new Map(),
      knownDatasetIds: known,
    })
    expect(diff.changes).toEqual([
      { videoId: 'inferred001', ownerId: 'ritsu', before: [], after: ['yuno'], source: 'title' },
    ])
  })

  it('显式空数组会清掉标题推断结果', () => {
    const diff = planCollaborationUpdates({
      rows: [
        { videoId: 'registered01', datasetId: 'ritsu', title: 'ユノと律の雑談', participants: ['yuno'] },
      ],
      manual: new Map([['registered01', []]]),
      knownDatasetIds: known,
    })
    expect(diff.changes[0]).toMatchObject({ after: [], source: 'manual' })
  })

  it('inferFromTitles=false 时只对登记表里的场次对账', () => {
    const diff = planCollaborationUpdates({
      rows: [
        { videoId: 'inferred001', datasetId: 'ritsu', title: 'ユノと律の雑談', participants: [] },
      ],
      manual: new Map(),
      knownDatasetIds: known,
      inferFromTitles: false,
    })
    expect(diff.changes).toEqual([])
  })

  it('登记把 owner 写成参与者时跳过并报冲突', () => {
    const diff = planCollaborationUpdates({
      rows: [
        { videoId: 'registered01', datasetId: 'ritsu', title: '', participants: [] },
      ],
      manual: new Map([['registered01', ['ritsu', 'yuno']]]),
      knownDatasetIds: known,
    })
    expect(diff.changes).toEqual([])
    expect(diff.conflicts).toEqual([{ videoId: 'registered01', ownerId: 'ritsu' }])
  })

  it('reportMissing 时列出库里没有的登记', () => {
    const diff = planCollaborationUpdates({
      rows: [],
      manual: new Map([['missing00001', ['yuno']]]),
      knownDatasetIds: known,
      reportMissing: true,
    })
    expect(diff.missing).toEqual(['missing00001'])
  })

  it('skipVideoIds 让刚被 ingest 写过的行不重复写入', () => {
    const diff = planCollaborationUpdates({
      rows: [
        { videoId: 'inferred001', datasetId: 'ritsu', title: 'ユノと律の雑談', participants: [] },
      ],
      manual: new Map(),
      knownDatasetIds: known,
      skipVideoIds: ['inferred001'],
    })
    expect(diff.changes).toEqual([])
  })
})
