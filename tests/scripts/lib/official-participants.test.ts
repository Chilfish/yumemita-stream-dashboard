import { describe, expect, it } from 'vitest'
import {
  castFromDescription,
  resolveParticipants,
} from '@scripts/lib/collaborations.ts'

const MEMBERS = ['nonoka', 'arale', 'ritsu', 'miyako', 'yuno']

describe('castFromDescription', () => {
  it('只取出演者区块里的成员', () => {
    const description = [
      '【出演】',
      '仲町あられ',
      '峰月律',
      '',
      '公式サイト：https://example.com',
    ].join('\n')
    expect(castFromDescription(description, MEMBERS)).toEqual(['arale', 'ritsu'])
  })

  it('支持「出演者」「キャスト」写法', () => {
    expect(castFromDescription('出演者\n千石ユノ', MEMBERS)).toEqual(['yuno'])
    expect(castFromDescription('キャスト：藤都子', MEMBERS)).toEqual(['miyako'])
  })

  it('没有出演者区块时返回空，不扫整段简介里的全员名单', () => {
    const description = '夢限大みゅーたいぷ\nVo. 仲町あられ\nGt. 宮永ののか\nBa. 峰月律'
    expect(castFromDescription(description, MEMBERS)).toEqual([])
  })

  it('忽略未知成员', () => {
    expect(castFromDescription('出演：仲町あられ、謎の人物', MEMBERS)).toEqual(['arale'])
  })

  it('简介为空时安全返回', () => {
    expect(castFromDescription(null, MEMBERS)).toEqual([])
    expect(castFromDescription('', MEMBERS)).toEqual([])
  })
})

describe('resolveParticipants 官方规则', () => {
  const manual = new Map<string, string[]>()

  it('官方 all：默认全员，排除 owner', () => {
    const resolved = resolveParticipants({
      videoId: 'u7f5p223ByA',
      ownerId: 'yumemita',
      title: 'デビュー3周年記念配信',
      manual,
      knownDatasetIds: MEMBERS,
      official: { mode: 'all' },
    })
    expect(resolved.source).toBe('default')
    expect(resolved.ids).toEqual(MEMBERS)
  })

  it('官方 cast：按简介出演者', () => {
    const resolved = resolveParticipants({
      videoId: 'Eo8iRGa0neM',
      ownerId: 'bangdream',
      title: 'バンドリ！TV LIVE 2026 #332',
      description: '出演者\n仲町あられ\n峰月律',
      manual,
      knownDatasetIds: MEMBERS,
      official: { mode: 'cast' },
    })
    expect(resolved.source).toBe('cast')
    expect(resolved.ids).toEqual(['arale', 'ritsu'])
  })

  it('官方 cast 没有出演者时不推断', () => {
    const resolved = resolveParticipants({
      videoId: 'x',
      ownerId: 'bangdream',
      title: 'バンドリ！TV LIVE 2026 #333',
      description: 'ゆめみた のメンバーが出演します',
      manual,
      knownDatasetIds: MEMBERS,
      official: { mode: 'cast' },
    })
    expect(resolved.ids).toEqual([])
    expect(resolved.source).toBe('none')
  })

  it('官方 none：只能靠登记', () => {
    const resolved = resolveParticipants({
      videoId: 'Jih2ArVViRo',
      ownerId: 'other',
      title: 'イヤホンレビュー',
      manual,
      knownDatasetIds: MEMBERS,
      official: { mode: 'none' },
    })
    expect(resolved.ids).toEqual([])
  })

  it('登记优先于官方规则', () => {
    const withManual = new Map([['Eo8iRGa0neM', ['yuno']]])
    const resolved = resolveParticipants({
      videoId: 'Eo8iRGa0neM',
      ownerId: 'bangdream',
      title: 'バンドリ！TV LIVE 2026 #332',
      description: '出演者\n仲町あられ\n峰月律',
      manual: withManual,
      knownDatasetIds: MEMBERS,
      official: { mode: 'cast' },
    })
    expect(resolved.source).toBe('manual')
    expect(resolved.ids).toEqual(['yuno'])
  })

  it('官方场次不做标题推断', () => {
    const resolved = resolveParticipants({
      videoId: 'x',
      ownerId: 'yumemita',
      title: '【ゲスト】仲町あられ と 峰月律',
      manual,
      knownDatasetIds: MEMBERS,
      official: null,
    })
    expect(resolved.ids).toEqual([])
  })

  it('成员频道仍走标题推断', () => {
    const resolved = resolveParticipants({
      videoId: 'fvSCCUPBzU0',
      ownerId: 'ritsu',
      title: '【#ぎたーグミ コラボ】ののちゃんとギター弾いてみる！',
      manual,
      knownDatasetIds: MEMBERS,
    })
    expect(resolved.source).toBe('title')
    expect(resolved.ids).toContain('nonoka')
  })
})
