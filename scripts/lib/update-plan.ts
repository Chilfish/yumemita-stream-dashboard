/**
 * 一次定时更新的规划：从「频道列表 + 已发布清单」算出这次真正要动哪些场次。
 *
 * 三种候选：
 * - `newIds`：频道里有、清单里没有、且不是未来场/摘要的场次（正常增量）；
 * - `forceIds`：清单里已有、但需要重抓的场次，原因写进 `reasons`；
 * - 其余场次不动。
 *
 * 缺 VSTATS 不在这里重抓：`backfill-vstats.ts` 只请求单场页就能补，成本远低于整套素材重抓，
 * 且不受 14 天窗口限制。这里只负责「缺弹幕」的定点重抓与超窗口记录。
 *
 * 未来场（`is_upcoming`）和正在直播（`is_live`）不进入候选，等下一轮变成 `was_live`
 * 再处理；同名但明显更短的摘要/切片也不进入候选，避免每天重新判定。
 *
 * 纯函数，不碰网络与文件，方便单测。
 */

export interface ChannelEntry {
  id: string
  title?: string | null
  durationSec?: number | null
  liveStatus?: string | null
  /** 频道列表里能拿到的预定开播时刻（ISO）；拿不到时为 null。 */
  scheduledAt?: string | null
}

export interface PlanStream {
  videoId: string
  title?: string | null
  durationSec?: number | null
  startedAt?: string | null
  endedAt?: string | null
  availability?: string | null
  vstatsViews?: number | null
  avgConcurrent?: number | null
  chatTotal?: number | null
}

export interface PlanOptions {
  /** 频道 `/streams` 的顺序（最新在前）。 */
  channel: ChannelEntry[]
  /** 已发布清单里的 videoId。 */
  knownIds: Iterable<string>
  streams: PlanStream[]
  /** 判定“近 24 小时”的基准；默认当前时刻。 */
  now?: Date
  /** 重抓最近 N 小时内结束的场次；0 = 关闭（不加 --force 时）。 */
  forceRecentHours?: number
  /** 弹幕为空时，多少天内继续重试。 */
  chatGapDays?: number
}

export interface DatasetPlan {
  /** 频道顺序的新场次。 */
  newIds: string[]
  /** 因为未来场 / 同名摘要而暂时不处理的场次。 */
  deferredIds: string[]
  /** 需要 `--force` 的场次，按清单顺序（最新在前）。 */
  forceIds: string[]
  /** 超过弹幕重试窗口、本次不再尝试的场次；用于在运行摘要里留下终态。 */
  expiredIds: string[]
  /** videoId → 原因，打日志用。 */
  reasons: Map<string, string>
}

const HOUR_MS = 3600_000
const DAY_MS = 24 * HOUR_MS
/** 同标题时，短于正片 60% 视为摘要 / 切片。与 fetch-streams 的口径一致。 */
const SUMMARY_RATIO = 0.6

function endMs(stream: PlanStream): number | null {
  const raw = stream.endedAt ?? stream.startedAt
  if (!raw) return null
  const value = Date.parse(raw)
  return Number.isFinite(value) ? value : null
}

export function planDataset(options: PlanOptions): DatasetPlan {
  const nowMs = (options.now ?? new Date()).getTime()
  const known = new Set(options.knownIds)

  const knownByTitle = new Map<string, number>()
  for (const stream of options.streams) {
    if (!stream.title) continue
    knownByTitle.set(stream.title, Math.max(knownByTitle.get(stream.title) ?? 0, stream.durationSec ?? 0))
  }

  const newIds: string[] = []
  const deferredIds: string[] = []
  const reasons = new Map<string, string>()
  for (const entry of options.channel) {
    if (known.has(entry.id)) continue
    if (entry.liveStatus === 'is_upcoming') {
      deferredIds.push(entry.id)
      reasons.set(entry.id, '未来场')
      continue
    }
    if (entry.liveStatus === 'is_live') {
      deferredIds.push(entry.id)
      reasons.set(entry.id, '直播中')
      continue
    }
    const knownDuration = entry.title ? knownByTitle.get(entry.title) : undefined
    if (knownDuration != null && entry.durationSec != null && entry.durationSec < knownDuration * SUMMARY_RATIO) {
      deferredIds.push(entry.id)
      reasons.set(entry.id, `同名摘要（正片 ${knownDuration}s）`)
      continue
    }
    newIds.push(entry.id)
  }

  const forceRecentHours = options.forceRecentHours ?? 0
  const chatGapDays = options.chatGapDays ?? 7
  const recentCutoff = nowMs - forceRecentHours * HOUR_MS

  const forceIds: string[] = []
  const expiredIds: string[] = []
  for (const stream of options.streams) {
    if (!known.has(stream.videoId)) continue
    const end = endMs(stream)
    if (end == null) continue
    const age = nowMs - end
    // 未来场 / 正在直播：交给正常抓取流程按 live_status 跳过。
    if (age < 0) continue

    if (forceRecentHours > 0 && end >= recentCutoff) {
      forceIds.push(stream.videoId)
      reasons.set(stream.videoId, `近 ${forceRecentHours} 小时`)
      continue
    }
    if ((stream.chatTotal ?? 0) === 0 && age <= chatGapDays * DAY_MS) {
      forceIds.push(stream.videoId)
      reasons.set(stream.videoId, '缺弹幕')
      continue
    }
    // 超过重试窗口仍缺弹幕：记录为终态，不再静默消失。
    if ((stream.chatTotal ?? 0) === 0) {
      expiredIds.push(stream.videoId)
      reasons.set(stream.videoId, `缺弹幕已超过 ${chatGapDays} 天`)
    }
  }

  return { newIds, deferredIds, forceIds, expiredIds, reasons }
}
