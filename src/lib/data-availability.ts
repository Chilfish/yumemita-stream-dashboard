/**
 * 单场页的空数据归因。
 *
 * `chat.total === 0` 同时代表三件事：投稿本来就没有弹幕、平台没保留直播回放、
 * 我们没抓到（`postmortem/004`）。页面只能靠视频元信息区分，不能只判总数。
 *
 * 两个信号都不完整，所以按顺序取第一个能说明问题的：
 * - `availability` 只认会员限定，它一定伴随明细屏蔽；
 * - `liveStatus === 'not_live'` 是投稿，平台不会产生弹幕；
 * - `hasLiveChatReplay === false` 且 `liveStatus` 是直播态，才是「平台没留回放」。
 *   旧 pack 缺这个键时重建会得到 `false`，所以必须配合 `liveStatus` 一起判断，
 *   否则会把无法判定的旧数据误标成「平台没有」。
 * 其余情况一律落到 `quiet`：只陈述没有记录，不做归因。
 */

export type ChatUnavailableReason =
  /** 会员限定，明细不公开。 */
  | 'member-only'
  /** 投稿视频：平台不产生弹幕与 SC。 */
  | 'not-live'
  /** 直播已结束，但 YouTube 没有保留弹幕回放。 */
  | 'no-replay'
  /** 有回放却没有条目，或旧数据无法判定原因。 */
  | 'quiet'

export type ChatAvailability =
  | { state: 'available' }
  | { state: 'unavailable', reason: ChatUnavailableReason }

const MEMBER_ONLY = 'subscriber_only'
const NOT_LIVE = 'not_live'
/** 直播结束后的两种状态：只有它们才可能出现「平台没留回放」。 */
const LIVE_ENDED = new Set(['was_live', 'post_live'])

export function resolveChatAvailability(input: {
  availability: string | null
  liveStatus: string | null
  hasLiveChatReplay: boolean
  total: number
}): ChatAvailability {
  if (input.total > 0) return { state: 'available' }
  if (input.availability === MEMBER_ONLY) return { state: 'unavailable', reason: 'member-only' }
  if (input.liveStatus === NOT_LIVE) return { state: 'unavailable', reason: 'not-live' }
  if (
    input.liveStatus != null
    && LIVE_ENDED.has(input.liveStatus)
    && input.hasLiveChatReplay === false
  ) {
    return { state: 'unavailable', reason: 'no-replay' }
  }
  return { state: 'unavailable', reason: 'quiet' }
}

export interface UnavailableCopy {
  /** 这个区块是什么、为什么空。 */
  message: string
  /** 下一步或边界说明。 */
  hint: string
}

/** 空态文案：说清是什么、为什么空、能做什么（`writing-style.md` 界面文案）。 */
export function chatUnavailableCopy(reason: ChatUnavailableReason): UnavailableCopy {
  switch (reason) {
    case 'member-only':
      return { message: '会员限定，明细不公开', hint: '本站只展示封面、标题与时间。' }
    case 'not-live':
      return { message: '这是投稿视频，没有弹幕与 SC', hint: '弹幕只存在于直播回放；投稿的互动在评论区。' }
    case 'no-replay':
      return { message: 'YouTube 没有保留这场直播的弹幕回放', hint: '平台侧不提供，重新抓取也补不回来。' }
    case 'quiet':
    default:
      return { message: '这场没有弹幕记录', hint: '回放里没有可用条目，或平台没有保留。' }
  }
}

export type DefaultStreamSubView = 'overview' | 'comments'

/**
 * 没有弹幕可看时，把首屏让给评论区。
 * 回放缺失的直播和投稿视频，评论往往是页面上唯一还能读的内容。
 */
export function pickDefaultStreamSubView(input: {
  chatAvailable: boolean
  hasComments: boolean
}): DefaultStreamSubView {
  return !input.chatAvailable && input.hasComments ? 'comments' : 'overview'
}
