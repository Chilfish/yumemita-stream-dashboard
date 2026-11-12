import { describe, expect, it } from 'vitest'
import {
  buildGroupDataFromStreams,
  mergeParticipantDays,
  mergeParticipantStats,
  pickLatestStreams,
} from './group'
import type { DatasetIndexEntry } from '@/types/dataset'
import type { GroupStreamSummary } from '@/types/group'

function member(id: string, label: string): DatasetIndexEntry {
  return {
    id,
    label,
    color: '#ffcb5b',
    channelId: null,
    count: 0,
    generatedAt: null,
    manifest: `${id}/manifest.json`,
  }
}

function row(overrides: Partial<GroupStreamSummary> & { date: string, videoId: string }): GroupStreamSummary {
  return {
    datasetId: 'ritsu',
    title: overrides.videoId,
    startedAt: `${overrides.date}T20:00:00+09:00`,
    durationSec: 3600,
    availability: null,
    avgConcurrent: 100,
    maxConcurrent: 200,
    chatTotal: 1000,
    superchats: 10,
    vstatsViews: null,
    snapshotViews: null,
    thumbnail: null,
    ...overrides,
  }
}

const collab = row({
  datasetId: 'ritsu',
  participants: ['nonoka'],
  date: '2026-07-25',
  videoId: 'fvSCCUPBzU0',
})

describe('mergeParticipantStats', () => {
  it('把联动场同时计入 owner 与参与者', () => {
    const stats = [
      { datasetId: 'ritsu', streamCount: 2, chatTotal: 500, superchats: 1, durationSec: 600, avgConcurrent: 50 },
      { datasetId: 'nonoka', streamCount: 3, chatTotal: 900, superchats: 2, durationSec: 900, avgConcurrent: 90 },
    ]

    mergeParticipantStats(stats, [collab])

    const ritsu = stats.find(item => item.datasetId === 'ritsu')
    const nonoka = stats.find(item => item.datasetId === 'nonoka')
    // owner 的场次已由 SQL 统计过，这里只补参与者。
    expect(ritsu?.streamCount).toBe(2)
    expect(nonoka?.streamCount).toBe(4)
    expect(nonoka?.chatTotal).toBe(1900)
    expect(ritsu?.chatTotal).toBe(500)
  })

  it('按同接 × 时长加权重算平均同接', () => {
    const stats = [
      { datasetId: 'nonoka', streamCount: 1, chatTotal: 0, superchats: 0, durationSec: 3600, avgConcurrent: 300 },
    ]

    mergeParticipantStats(stats, [collab])

    // (300×3600 + 100×3600) / 7200
    expect(stats[0]?.avgConcurrent).toBe(200)
  })

  it('会员限定场只计场次，不累加派生指标', () => {
    const stats = [
      { datasetId: 'nonoka', streamCount: 0, chatTotal: 0, superchats: 0, durationSec: 0, avgConcurrent: null },
    ]

    mergeParticipantStats(stats, [{ ...collab, availability: 'subscriber_only' }])

    expect(stats[0]?.streamCount).toBe(1)
    expect(stats[0]?.chatTotal).toBe(0)
    expect(stats[0]?.durationSec).toBe(0)
  })
})

describe('mergeParticipantDays', () => {
  it('为参与者补日桶并累加弹幕', () => {
    const days = [{ datasetId: 'ritsu', date: '2026-07-25', streams: 1, chat: 1000 }]

    mergeParticipantDays(days, [collab])

    expect(days.find(day => day.datasetId === 'nonoka')).toEqual({
      datasetId: 'nonoka',
      date: '2026-07-25',
      streams: 1,
      chat: 1000,
    })
  })
})

describe('pickLatestStreams', () => {
  it('联动场比成员自己的上一场更新时，用联动场做最新场并标记 owner', () => {
    const latest = [
      row({ datasetId: 'nonoka', date: '2026-01-01', videoId: 'old' }),
      row({ datasetId: 'ritsu', date: '2026-07-25', videoId: 'fvSCCUPBzU0' }),
    ]

    const picked = pickLatestStreams(latest, [collab])
    const nonoka = picked.find(item => item.datasetId === 'nonoka')

    expect(nonoka?.videoId).toBe('fvSCCUPBzU0')
    expect(nonoka?.ownerDatasetId).toBe('ritsu')
  })

  it('联动场更早时保留成员自己的最新场', () => {
    const latest = [row({ datasetId: 'nonoka', date: '2026-09-01', videoId: 'newer' })]

    const picked = pickLatestStreams(latest, [collab])

    expect(picked.find(item => item.datasetId === 'nonoka')?.videoId).toBe('newer')
  })
})

describe('buildGroupDataFromStreams', () => {
  const datasets = [member('ritsu', '峰月律'), member('nonoka', '宮永ののか')]
  const streams = [
    collab,
    row({ datasetId: 'nonoka', date: '2026-08-01', videoId: 'solo' }),
  ]

  it('全组列表不会因为联动场多出一行', () => {
    const data = buildGroupDataFromStreams(datasets, streams)
    expect(data.rows.map(item => item.videoId)).toEqual(['solo', 'fvSCCUPBzU0'])
  })

  it('成员统计包含参与的联动场', () => {
    const data = buildGroupDataFromStreams(datasets, streams)
    const nonoka = data.members.find(item => item.dataset.id === 'nonoka')
    const ritsu = data.members.find(item => item.dataset.id === 'ritsu')

    expect(nonoka?.streamCount).toBe(2)
    expect(ritsu?.streamCount).toBe(1)
    // 全组合计按 videoId 去重：2 场，不是 3。
    expect(data.totals.streamCount).toBe(2)
  })

  it('相册行的 owner 与参与者标签可用', () => {
    const data = buildGroupDataFromStreams(datasets, streams)
    const collabRow = data.rows.find(item => item.videoId === 'fvSCCUPBzU0')

    expect(collabRow?.datasetId).toBe('ritsu')
    expect(collabRow?.ownerDatasetId).toBe('ritsu')
    expect(collabRow?.participantLabels).toEqual(['宮永ののか'])
  })
})
