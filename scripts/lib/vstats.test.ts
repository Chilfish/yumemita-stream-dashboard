import { describe, expect, it } from 'vitest'
import { deriveVstats, parseVstats, VSTATS_MIN_HTML_BYTES } from './vstats.ts'

const HTML = `
<html><body>
<div>最終更新: 2026-11-14 11:40:04</div>
<div><span>開始時刻</span><span>2026-09-22 10:00:24</span></div>
<div><span>終了時刻</span><span>2026-09-22 11:08:31</span></div>
<div><span>配信時間</span><span>1:08:12</span></div>
<div><span>最大視聴者数</span><span class="fs-5 fw-bold">1,440</span><span>(09/22 11:01)</span></div>
<div><span>平均視聴者数</span><span class="fs-5 fw-bold">1,086</span></div>
<div><span>視聴時間</span><span class="fs-5 fw-bold">1,231</span></div>
<div><span>再生数</span><span class="fs-5 fw-bold">48,488</span></div>
<div><span>高評価数</span><span class="fs-5 fw-bold">1,086</span></div>
</body></html>
`

describe('parseVstats', () => {
  it('解析单场页的统计块', () => {
    expect(parseVstats(HTML)).toEqual({
      updatedAt: '2026-11-14 11:40:04',
      startedAt: '2026-09-22T10:00:24+09:00',
      endedAt: '2026-09-22T11:08:31+09:00',
      durationText: '1:08:12',
      maxConcurrent: 1440,
      maxConcurrentAt: '09/22 11:01',
      avgConcurrent: 1086,
      watchTimeHours: 1231,
      views: 48488,
      likes: 1086,
    })
  })

  it('未收录页面（5 字节 error）全部为 null', () => {
    expect('error'.length).toBeLessThan(VSTATS_MIN_HTML_BYTES)
    expect(parseVstats('error')).toEqual({
      updatedAt: null,
      startedAt: null,
      endedAt: null,
      durationText: null,
      maxConcurrent: null,
      maxConcurrentAt: null,
      avgConcurrent: null,
      watchTimeHours: null,
      views: null,
      likes: null,
    })
  })
})

describe('deriveVstats', () => {
  const vstats = parseVstats(HTML)

  it('按弹幕总数与快照播放数算派生比值', () => {
    expect(deriveVstats(vstats, 5873, 48346)).toEqual({
      chatPer1000AvgViewers: 5407.9,
      likesPer1000Views: 22.4,
      vstatsVsYtdlpViews: -142,
    })
  })

  it('没有 VSTATS 时全部为 null', () => {
    expect(deriveVstats(null, 100, 200)).toEqual({
      chatPer1000AvgViewers: null,
      likesPer1000Views: null,
      vstatsVsYtdlpViews: null,
    })
  })
})
