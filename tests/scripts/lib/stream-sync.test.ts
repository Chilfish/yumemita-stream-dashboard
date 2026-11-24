import { describe, expect, it } from 'vitest'
import { planStreamPull } from '@scripts/lib/stream-sync.ts'

function state(videoId: string, contentHash: string | null): { videoId: string, contentHash: string | null } {
  return { videoId, contentHash }
}

describe('planStreamPull', () => {
  it('本机缺失的场次按 missing 写入', () => {
    const plan = planStreamPull([], [state('a', 'hash-a')])

    expect(plan).toEqual({ entries: [{ videoId: 'a', reason: 'missing' }], localOnly: [] })
  })

  it('hash 不一致时按 changed 覆盖', () => {
    const plan = planStreamPull([state('a', 'old')], [state('a', 'new')])

    expect(plan.entries).toEqual([{ videoId: 'a', reason: 'changed' }])
  })

  it('hash 相同则跳过已一致的场次', () => {
    const plan = planStreamPull([state('a', 'same')], [state('a', 'same')])

    expect(plan.entries).toEqual([])
  })

  it('hash 相同也覆盖，只要带 force', () => {
    const plan = planStreamPull([state('a', 'same')], [state('a', 'same')], { force: true })

    expect(plan.entries).toEqual([{ videoId: 'a', reason: 'forced' }])
  })

  it('force 时本机缺失仍记为 missing', () => {
    const plan = planStreamPull([state('a', 'x')], [state('a', 'x'), state('b', 'y')], { force: true })

    expect(plan.entries).toEqual([
      { videoId: 'a', reason: 'forced' },
      { videoId: 'b', reason: 'missing' },
    ])
  })

  it('任一侧 hash 缺失视为不一致', () => {
    expect(planStreamPull([state('a', null)], [state('a', 'x')]).entries).toEqual([
      { videoId: 'a', reason: 'changed' },
    ])
    expect(planStreamPull([state('a', 'x')], [state('a', null)]).entries).toEqual([
      { videoId: 'a', reason: 'changed' },
    ])
  })

  it('本机独有的场次单独返回，交给调用方清理', () => {
    const plan = planStreamPull(
      [state('a', 'x'), state('draft', 'y')],
      [state('a', 'x')],
    )

    expect(plan.entries).toEqual([])
    expect(plan.localOnly).toEqual(['draft'])
  })

  it('保持线上顺序，便于分批写入', () => {
    const plan = planStreamPull([], [state('c', null), state('a', null), state('b', null)])

    expect(plan.entries.map(entry => entry.videoId)).toEqual(['c', 'a', 'b'])
  })
})
