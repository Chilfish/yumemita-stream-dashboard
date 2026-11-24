import { describe, expect, it } from 'vitest'
import {
  chatUnavailableCopy,
  pickDefaultStreamSubView,
  resolveChatAvailability,
} from '@/lib/data-availability'

function resolve(overrides: Partial<Parameters<typeof resolveChatAvailability>[0]> = {}) {
  return resolveChatAvailability({
    availability: 'public',
    hasLiveChatReplay: true,
    liveStatus: 'was_live',
    total: 0,
    ...overrides,
  })
}

describe('resolveChatAvailability', () => {
  it('有弹幕时一律视为可用，不受元信息影响', () => {
    expect(resolve({ total: 1204 })).toEqual({ state: 'available' })
    expect(resolve({ total: 1, availability: 'subscriber_only' })).toEqual({ state: 'available' })
    expect(resolve({ total: 1, liveStatus: 'not_live' })).toEqual({ state: 'available' })
  })

  it('会员限定优先于其它原因', () => {
    expect(resolve({ availability: 'subscriber_only', liveStatus: 'was_live' })).toEqual({
      reason: 'member-only',
      state: 'unavailable',
    })
  })

  it('liveStatus 为 not_live 时判为投稿', () => {
    expect(resolve({ hasLiveChatReplay: false, liveStatus: 'not_live' })).toEqual({
      reason: 'not-live',
      state: 'unavailable',
    })
  })

  it('直播已结束且没有回放时判为平台未保留', () => {
    expect(resolve({ hasLiveChatReplay: false, liveStatus: 'was_live' })).toEqual({
      reason: 'no-replay',
      state: 'unavailable',
    })
    expect(resolve({ hasLiveChatReplay: false, liveStatus: 'post_live' })).toEqual({
      reason: 'no-replay',
      state: 'unavailable',
    })
  })

  it('旧数据缺 liveStatus 时不归因，只陈述没有记录', () => {
    expect(resolve({ hasLiveChatReplay: false, liveStatus: null })).toEqual({
      reason: 'quiet',
      state: 'unavailable',
    })
  })

  it('有回放但没有条目时也落到 quiet', () => {
    expect(resolve({ hasLiveChatReplay: true, liveStatus: 'was_live' })).toEqual({
      reason: 'quiet',
      state: 'unavailable',
    })
  })
})

describe('chatUnavailableCopy', () => {
  it('每种原因都同时给出 message 与 hint', () => {
    for (const reason of ['member-only', 'not-live', 'no-replay', 'quiet'] as const) {
      const copy = chatUnavailableCopy(reason)
      expect(copy.message.length).toBeGreaterThan(0)
      expect(copy.hint.length).toBeGreaterThan(0)
    }
  })

  it('投稿与「平台未保留」用不同文案，避免把原因说错', () => {
    expect(chatUnavailableCopy('not-live').message).not.toBe(chatUnavailableCopy('no-replay').message)
  })
})

describe('pickDefaultStreamSubView', () => {
  it('有弹幕时停在概览', () => {
    expect(pickDefaultStreamSubView({ chatAvailable: true, hasComments: true })).toBe('overview')
  })

  it('没有弹幕但有评论时落到评论', () => {
    expect(pickDefaultStreamSubView({ chatAvailable: false, hasComments: true })).toBe('comments')
  })

  it('没有弹幕也没有评论时仍停在概览', () => {
    expect(pickDefaultStreamSubView({ chatAvailable: false, hasComments: false })).toBe('overview')
  })
})
