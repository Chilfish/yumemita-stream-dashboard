import { describe, expect, it } from 'vitest'
import {
  planCollaborations,
  suggestParticipants,
} from './collaborations'

const known = ['nonoka', 'arale', 'ritsu', 'miyako', 'yuno']

describe('planCollaborations', () => {
  it('保留登记顺序并去重', () => {
    const plan = planCollaborations(
      { streams: { fvSCCUPBzU0: ['yuno', 'nonoka', 'yuno'] } },
      { knownDatasetIds: known },
    )
    expect(plan.byVideo.get('fvSCCUPBzU0')).toEqual(['yuno', 'nonoka'])
    expect(plan.skipped).toEqual([
      { videoId: 'fvSCCUPBzU0', datasetId: 'yuno', reason: '重复登记' },
    ])
  })

  it('拒绝未知成员，不阻塞其余参与者', () => {
    const plan = planCollaborations(
      { streams: { fvSCCUPBzU0: ['nonoka', 'unknown'] } },
      { knownDatasetIds: known },
    )
    expect(plan.byVideo.get('fvSCCUPBzU0')).toEqual(['nonoka'])
    expect(plan.skipped[0]?.reason).toBe('未知成员 id')
  })

  it('owner 不能登记成参与者', () => {
    const plan = planCollaborations(
      { streams: { fvSCCUPBzU0: ['ritsu', 'nonoka'] } },
      { knownDatasetIds: known, ownerByVideo: new Map([['fvSCCUPBzU0', 'ritsu']]) },
    )
    expect(plan.byVideo.get('fvSCCUPBzU0')).toEqual(['nonoka'])
    expect(plan.skipped[0]?.reason).toBe('owner 不需要登记为参与者')
  })

  it('全部被拒绝时不写入空数组', () => {
    const plan = planCollaborations(
      { streams: { fvSCCUPBzU0: [] } },
      { knownDatasetIds: known },
    )
    expect(plan.byVideo.has('fvSCCUPBzU0')).toBe(false)
  })

  it('非法 videoId 与非数组值进入跳过项', () => {
    const plan = planCollaborations(
      { streams: { short: ['nonoka'], fvSCCUPBzU0: 'nonoka' } },
      { knownDatasetIds: known },
    )
    expect(plan.byVideo.size).toBe(0)
    expect(plan.skipped.map(item => item.reason)).toEqual([
      'videoId 不是 11 位',
      '参与者必须是数组',
    ])
  })

  it('文件缺失时返回空计划', () => {
    expect(planCollaborations(null, { knownDatasetIds: known }).byVideo.size).toBe(0)
  })
})

describe('suggestParticipants', () => {
  it('命中其他成员的别名', () => {
    expect(
      suggestParticipants('【峰月律/宮永ののか】弾き語り', 'ritsu', known),
    ).toEqual(['nonoka'])
  })

  it('不把自己的别名算成参与者', () => {
    expect(suggestParticipants('峰月律の雑談', 'ritsu', known)).toEqual([])
  })

  it('组合名 tag 命中整对成员', () => {
    expect(
      suggestParticipants('#りつみやコラボ おえかきの森', 'ritsu', known),
    ).toEqual(['miyako'])
    expect(
      suggestParticipants('【It Takes Two】ユノりつ', 'ritsu', known),
    ).toEqual(['yuno'])
  })

  it('组合名与成员别名合并去重', () => {
    expect(
      suggestParticipants('峰月律とぎたーグミで遊ぶ', 'nonoka', known),
    ).toEqual(['ritsu'])
  })
})
