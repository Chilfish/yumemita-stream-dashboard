import { describe, expect, it } from 'vitest'
import type { StreamSummary } from '@/types/dataset'
import { maskMemberOnlyMetrics } from './shared'

function summary(overrides: Partial<StreamSummary> = {}): StreamSummary {
  return {
    availability: 'public',
    durationSec: 600,
    chatTotal: 100,
    superchats: 2,
    avgConcurrent: 50,
    maxConcurrent: 80,
    vstatsViews: 1000,
    uniqueAuthors: 20,
    commentsCaptured: 5,
    ...overrides,
  } as StreamSummary
}

describe('maskMemberOnlyMetrics', () => {
  it('clears derived metrics but keeps metadata for member-only streams', () => {
    const masked = maskMemberOnlyMetrics(summary({
      availability: 'subscriber_only',
      title: '会员限定场',
      startedAt: '2026-10-01T20:00:00.000Z',
    }))

    expect(masked).toMatchObject({
      title: '会员限定场',
      startedAt: '2026-10-01T20:00:00.000Z',
      durationSec: 600,
      chatTotal: 0,
      superchats: 0,
      avgConcurrent: null,
      maxConcurrent: null,
      vstatsViews: null,
      uniqueAuthors: 0,
      commentsCaptured: null,
    })
  })

  it('returns public summaries unchanged', () => {
    const row = summary()
    expect(maskMemberOnlyMetrics(row)).toBe(row)
  })
})
