import { describe, expect, it } from 'vitest'
import { planDataset } from './update-plan.ts'

const now = new Date('2026-10-30T05:17:00Z')

function hoursAgo(hours: number): string {
  return new Date(now.getTime() - hours * 3600_000).toISOString()
}

describe('planDataset', () => {
  it('把频道里有、清单里没有的场次按频道顺序排成 newIds', () => {
    const plan = planDataset({
      channel: [{ id: 'c', liveStatus: 'was_live' }, { id: 'b', liveStatus: 'was_live' }, { id: 'a', liveStatus: 'was_live' }],
      knownIds: ['b'],
      streams: [{ videoId: 'b', startedAt: hoursAgo(48), vstatsViews: 1, chatTotal: 10 }],
      now,
    })
    expect(plan.newIds).toEqual(['c', 'a'])
    expect(plan.forceIds).toEqual([])
  })

  it('未来场和正在直播的场次不进候选', () => {
    const plan = planDataset({
      channel: [
        { id: 'future', liveStatus: 'is_upcoming' },
        { id: 'live', liveStatus: 'is_live' },
        { id: 'done', liveStatus: 'was_live', durationSec: 3600 },
      ],
      knownIds: [],
      streams: [],
      now,
    })
    expect(plan.newIds).toEqual(['done'])
    expect(plan.deferredIds).toEqual(['future', 'live'])
    expect(plan.reasons.get('future')).toBe('未来场')
  })

  it('同标题且明显更短的摘要不进候选', () => {
    const plan = planDataset({
      channel: [
        { id: 'summary', liveStatus: 'was_live', title: '配信', durationSec: 289 },
        { id: 'full', liveStatus: 'was_live', title: '新配信', durationSec: 3600 },
      ],
      knownIds: ['old'],
      streams: [{ videoId: 'old', title: '配信', durationSec: 7455, startedAt: hoursAgo(240), vstatsViews: 1, chatTotal: 10 }],
      now,
    })
    expect(plan.newIds).toEqual(['full'])
    expect(plan.deferredIds).toEqual(['summary'])
  })

  it('同标题但时长接近正片时保留（分场直播）', () => {
    const plan = planDataset({
      channel: [{ id: 'part2', liveStatus: 'was_live', title: '配信', durationSec: 4000 }],
      knownIds: ['old'],
      streams: [{ videoId: 'old', title: '配信', durationSec: 4500, startedAt: hoursAgo(240), vstatsViews: 1, chatTotal: 10 }],
      now,
    })
    expect(plan.newIds).toEqual(['part2'])
  })

  it('只把最近 N 小时结束的已有场次放进 forceIds', () => {
    const plan = planDataset({
      channel: [],
      knownIds: ['recent', 'old'],
      streams: [
        { videoId: 'recent', endedAt: hoursAgo(3), vstatsViews: 1, chatTotal: 10 },
        { videoId: 'old', endedAt: hoursAgo(30), vstatsViews: 1, chatTotal: 10 },
      ],
      now,
      forceRecentHours: 24,
    })
    expect(plan.forceIds).toEqual(['recent'])
    expect(plan.reasons.get('recent')).toContain('24')
  })

  it('不加 --force 时只重试缺 VSTATS / 缺弹幕的近期场次', () => {
    const plan = planDataset({
      channel: [],
      knownIds: ['no-vstats', 'no-chat', 'ok', 'stale-vstats', 'member-only'],
      streams: [
        { videoId: 'no-vstats', endedAt: hoursAgo(48), availability: 'public', vstatsViews: null, chatTotal: 10 },
        { videoId: 'no-chat', endedAt: hoursAgo(48), availability: 'public', vstatsViews: 3, chatTotal: 0 },
        { videoId: 'ok', endedAt: hoursAgo(48), availability: 'public', vstatsViews: 3, chatTotal: 10 },
        { videoId: 'stale-vstats', endedAt: hoursAgo(24 * 20), availability: 'public', vstatsViews: null, chatTotal: 10 },
        // 会员限定场次 VSTATS 本来就不收录，不重试。
        { videoId: 'member-only', endedAt: hoursAgo(48), availability: 'subscriber_only', vstatsViews: null, chatTotal: 10 },
      ],
      now,
    })
    expect(plan.forceIds).toEqual(['no-vstats', 'no-chat'])
    expect(plan.reasons.get('no-vstats')).toBe('缺 VSTATS')
    expect(plan.reasons.get('no-chat')).toBe('缺弹幕')
  })

  it('忽略未来场和正在直播的场次（force 分支）', () => {
    const plan = planDataset({
      channel: [],
      knownIds: ['future'],
      streams: [{ videoId: 'future', startedAt: new Date(now.getTime() + 3600_000).toISOString() }],
      now,
      forceRecentHours: 24,
    })
    expect(plan.forceIds).toEqual([])
  })

  it('同一场次只出现一次', () => {
    const plan = planDataset({
      channel: [],
      knownIds: ['x'],
      streams: [{ videoId: 'x', endedAt: hoursAgo(2), vstatsViews: null, chatTotal: 0 }],
      now,
      forceRecentHours: 24,
    })
    expect(plan.forceIds).toEqual(['x'])
    expect(plan.reasons.get('x')).toContain('24')
  })
})
