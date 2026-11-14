/**
 * VSTATS 单场页的解析与派生值，`stream-datapack` 与 `backfill-vstats` 共用。
 *
 * 页面是服务端渲染的固定版式：先跳到「最終更新」后的统计块，再按标签取其后的一小段抠值。
 * 站点对未收录的视频返回 5 字节的 `error`，调用方应按「未收录」处理，不要当成解析失败。
 */

export interface VstatsSnapshot {
  updatedAt: string | null
  startedAt: string | null
  endedAt: string | null
  durationText: string | null
  maxConcurrent: number | null
  maxConcurrentAt: string | null
  avgConcurrent: number | null
  watchTimeHours: number | null
  views: number | null
  likes: number | null
}

/** 低于这个字节数的响应不是单场页：站点未收录时只有 5 字节的 `error`。 */
export const VSTATS_MIN_HTML_BYTES = 1000

const UPDATED_AT_RE = /最終更新:\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/
const DATE_RE = /(\d{4}-\d{2}-\d{2})/
const TIME_RE = /(\d{2}:\d{2}:\d{2})/
const STAT_DURATION_RE = /(\d+:\d{2}:\d{2})/
const STAT_NUMBER_RE = /<span class="fs-5[^"]*">\s*([\d,]+)/
const MAX_CONCURRENT_AT_RE = /\((\d{1,2}\/\d{1,2} \d{2}:\d{2})\)/

function block(html: string, label: string, length = 700): string | null {
  const i = html.indexOf(label)
  return i < 0 ? null : html.slice(i, i + length)
}

function num(value: string | undefined): number | null {
  if (!value)
    return null
  const n = Number(value.replaceAll(',', ''))
  return Number.isFinite(n) ? n : null
}

export function parseVstats(html: string): VstatsSnapshot {
  // 「最大視聴者数ランキング」「高評価数ランキング」这类导航词在页首，先跳到统计块再取标签。
  const detail = html.slice(Math.max(0, html.indexOf('最終更新')))
  const started = block(detail, '開始時刻')
  const ended = block(detail, '終了時刻')
  const duration = block(detail, '配信時間', 300)
  const maxBlock = block(detail, '最大視聴者数')
  const avgBlock = block(detail, '平均視聴者数', 400)
  const watchBlock = block(detail, '視聴時間', 400)
  const viewBlock = block(detail, '再生数', 400)
  const likeBlock = block(detail, '高評価数', 400)

  const stamp = (value: string | null): string | null => {
    if (!value)
      return null
    const date = DATE_RE.exec(value)?.[1]
    const time = TIME_RE.exec(value)?.[1]
    return date && time ? `${date}T${time}+09:00` : null
  }

  return {
    updatedAt: UPDATED_AT_RE.exec(html)?.[1] ?? null,
    startedAt: stamp(started),
    endedAt: stamp(ended),
    durationText: STAT_DURATION_RE.exec(duration ?? '')?.[1] ?? null,
    maxConcurrent: num(STAT_NUMBER_RE.exec(maxBlock ?? '')?.[1]),
    maxConcurrentAt: MAX_CONCURRENT_AT_RE.exec(maxBlock ?? '')?.[1] ?? null,
    avgConcurrent: num(STAT_NUMBER_RE.exec(avgBlock ?? '')?.[1]),
    watchTimeHours: num(STAT_NUMBER_RE.exec(watchBlock ?? '')?.[1]),
    views: num(STAT_NUMBER_RE.exec(viewBlock ?? '')?.[1]),
    likes: num(STAT_NUMBER_RE.exec(likeBlock ?? '')?.[1]),
  }
}

export interface VstatsDerived {
  chatPer1000AvgViewers: number | null
  likesPer1000Views: number | null
  vstatsVsYtdlpViews: number | null
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** 与 `stream-datapack` 的派生口径保持一致；没有 VSTATS 时全部为 null。 */
export function deriveVstats(
  vstats: VstatsSnapshot | null,
  chatTotal: number,
  snapshotViews: number | null,
): VstatsDerived {
  const avg = vstats?.avgConcurrent ?? null
  const views = vstats?.views ?? null
  const likes = vstats?.likes ?? null
  return {
    chatPer1000AvgViewers: avg && chatTotal ? round1((chatTotal / avg) * 1000) : null,
    likesPer1000Views: views && likes ? round1((likes / views) * 1000) : null,
    vstatsVsYtdlpViews: views != null && snapshotViews != null ? snapshotViews - views : null,
  }
}
