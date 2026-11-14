import { describe, expect, it } from 'vitest'
import {
  inferParticipants,
  planCollaborations,
  resolveParticipants,
  suggestParticipants,
} from '@scripts/lib/collaborations'

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

  it('空数组是显式覆盖，表示确认没有参与者', () => {
    const plan = planCollaborations(
      { streams: { fvSCCUPBzU0: [] } },
      { knownDatasetIds: known },
    )
    expect(plan.byVideo.get('fvSCCUPBzU0')).toEqual([])
    expect(plan.byVideo.has('fvSCCUPBzU0')).toBe(true)
  })

  it('全部是未知成员时不写入，避免拼写错误变成空覆盖', () => {
    const plan = planCollaborations(
      { streams: { fvSCCUPBzU0: ['unknown'] } },
      { knownDatasetIds: known },
    )
    expect(plan.byVideo.has('fvSCCUPBzU0')).toBe(false)
    expect(plan.skipped[0]?.reason).toBe('未知成员 id')
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

describe('inferParticipants', () => {
  it('命中标题里的昵称与组合名', () => {
    expect(
      inferParticipants('みゃーちゃんとののちゃんと #ゆめみたのウミガメのスープ', 'arale', known),
    ).toEqual(['nonoka', 'miyako'])
    expect(
      inferParticipants('ののののちゃんとバイトします', 'ritsu', known),
    ).toEqual(['nonoka'])
    expect(
      inferParticipants('💖ユノ＆律こらぼ💙', 'ritsu', known),
    ).toEqual(['yuno'])
  })

  it('排除只是在说成员的说法', () => {
    expect(
      inferParticipants('お絵描き あられと律を描く会', 'miyako', known),
    ).toEqual([])
    expect(
      inferParticipants('みゃーちゃんデザインどーなつ実食', 'arale', known),
    ).toEqual([])
    expect(
      inferParticipants('【ASMR/シチュボ】ヴァンパイア都子＆ユノ', 'yuno', known),
    ).toEqual([])
    expect(
      inferParticipants('【律いわく】ユノも真面目で素直な優等生になれるらしい', 'yuno', known),
    ).toEqual([])
  })

  it('不把旋律 / 法律里的律当成成员', () => {
    expect(inferParticipants('名曲の旋律を語る', 'yuno', known)).toEqual([])
    expect(inferParticipants('法律相談の話', 'yuno', known)).toEqual([])
  })

  it('忽略未知成员与 owner 自己', () => {
    expect(inferParticipants('宮永ののかと雑談', 'nonoka', known)).toEqual([])
  })
})

describe('resolveParticipants', () => {
  const manual = new Map<string, string[]>([['registered01', ['nonoka']]])

  it('手动登记优先于标题推断', () => {
    const result = resolveParticipants({
      videoId: 'registered01',
      ownerId: 'ritsu',
      title: 'ユノと律の雑談',
      manual,
      knownDatasetIds: known,
    })
    expect(result).toEqual({ ids: ['nonoka'], source: 'manual' })
  })

  it('显式空数组压制标题推断', () => {
    const empty = new Map<string, string[]>([['registered01', []]])
    const result = resolveParticipants({
      videoId: 'registered01',
      ownerId: 'ritsu',
      title: 'ユノと律の雑談',
      manual: empty,
      knownDatasetIds: known,
    })
    expect(result).toEqual({ ids: [], source: 'manual' })
  })

  it('没有登记时用标题推断', () => {
    const result = resolveParticipants({
      videoId: 'unknown0001',
      ownerId: 'ritsu',
      title: 'ユノと律の雑談',
      manual,
      knownDatasetIds: known,
    })
    expect(result).toEqual({ ids: ['yuno'], source: 'title' })
  })
})
