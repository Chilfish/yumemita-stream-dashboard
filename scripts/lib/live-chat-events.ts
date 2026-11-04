/**
 * InnerTube 实时弹幕里的「非消息」事件。
 *
 * `extractChatItems` 只处理 `addChatItemAction` 里的六种消息；等待室/直播中还会出现
 * 置顶公告、投票（含票数变化）、Q&A、商品、系统提示、慢速模式开关、删除/撤回、ticker 副本等。
 * 这些不进词频与消息计数（否则 `?view=words` 会被系统文案污染），但存档要保留：
 * - 事件写 `danmaku/events_<videoId>.jsonl`，`raw` 保留原始 renderer，便于以后重解析；
 * - 主播操作（置顶、发起投票、Q&A、上架商品）标 `owner: true`；
 * - `stream-datapack` 把 owner 事件并入 `chat.ownerChats`，其余进 `chat.events`。
 *
 * ticker（`addLiveChatTickerItemAction` / `liveChatTicker*Renderer`）是消息的滚动副本，
 * 按仓库既有口径忽略，并计入 `skipped`，不重复落档。
 */
import type { ChatEmoji, ChatItemWrapper, ChatRecord } from './live-chat.ts'
import { asArray, asRecord, findKey, pollActions, readMessageText } from './innertube-live.ts'
import { toRecord } from './live-chat.ts'

export type ChatEventType =
  | 'banner'
  | 'bannerRemoved'
  | 'poll'
  | 'pollUpdate'
  | 'qna'
  | 'product'
  | 'system'
  | 'modeChange'
  | 'deleted'
  | 'deletedAuthor'
  | 'replaced'
  | 'panel'
  | 'other'

export interface ChatEventRecord {
  seq: number
  video: string
  /** Unix 秒。没有 timestampUsec 的事件用采集时刻。 */
  at: number
  type: ChatEventType
  /** 事件是否由主播（或主播操作，如置顶、发起投票）产生。 */
  owner: boolean
  author?: string
  authorId?: string
  text: string | null
  /** 稳定 id（同一条事件在多次轮询中保持相同）。 */
  id?: string
  data?: Record<string, unknown>
  /** 原始 renderer / action 内容，供后续重新解析。 */
  raw?: unknown
}

export interface ExtractedEvents {
  events: ChatEventRecord[]
  /** 直接出现在 actions 里（未包在 addChatItemAction 中）的消息，正常情况为空。 */
  messages: ChatRecord[]
  skipped: Record<string, number>
}

/** 已知消息 renderer：正常情况下都包在 `addChatItemAction` 里。 */
const MESSAGE_RENDERERS = new Set([
  'liveChatTextMessageRenderer',
  'liveChatPaidMessageRenderer',
  'liveChatPaidStickerRenderer',
  'liveChatMembershipItemRenderer',
  'liveChatSponsorshipsGiftPurchaseAnnouncementRenderer',
  'liveChatSponsorshipsGiftRedemptionAnnouncementRenderer',
])

/** 纯 UI 结构，不是聊天事件。 */
const UI_RENDERERS = new Set([
  'liveChatDialogRenderer',
  'liveChatItemListRenderer',
  'liveChatHeaderRenderer',
  'liveChatParticipantsListRenderer',
  'liveChatParticipantRenderer',
  'liveChatEngagementPanelRenderer',
  'liveChatBannerHeaderRenderer',
])

/** action 上的元数据字段，不是事件，不计入 skipped。 */
const METADATA_KEYS = new Set([
  'clickTrackingParams',
  'trackingParams',
  'continuation',
  'item',
  'command',
  'params',
  'loggingDirectives',
])

function timestampUsToSec(value: unknown): number | null {
  if (value == null)
    return null
  const seconds = Number(value) / 1_000_000
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null
}

function atOf(renderer: Record<string, unknown> | null, fallback: number): number {
  return timestampUsToSec(renderer?.timestampUsec) ?? fallback
}

function pickText(renderer: Record<string, unknown>): string | null {
  for (const key of ['message', 'messageText', 'question', 'answer', 'title', 'headline', 'subtext']) {
    const text = readMessageText(renderer[key])
    if (text)
      return text
  }
  return readMessageText(findKey(renderer, 'message'))
}

interface PollChoice {
  text: string
  selected: boolean
  percentage: string | null
  ratio: number | null
}

interface PollSnapshot {
  question: string | null
  metadata: string | null
  pollType: string | null
  choices: PollChoice[]
  pollKey: string
  snapshotKey: string
}

function readPoll(poll: Record<string, unknown>): PollSnapshot {
  const header = asRecord(asRecord(poll.header)?.pollHeaderRenderer)
  const question = readMessageText(header?.pollQuestion)
  const metadata = readMessageText(header?.metadataText)
  const pollType = typeof header?.liveChatPollType === 'string' ? header.liveChatPollType : null
  const choices: PollChoice[] = asArray(poll.choices).map((choice) => {
    const record = asRecord(choice)
    return {
      text: readMessageText(record?.text) ?? '',
      selected: record?.selected === true,
      percentage: readMessageText(record?.votePercentage),
      ratio: typeof record?.voteRatio === 'number' ? record.voteRatio : null,
    }
  })
  const pollKey = question ?? choices.map(choice => choice.text).join('|')
  return {
    question,
    metadata,
    pollType,
    choices,
    pollKey,
    snapshotKey: JSON.stringify(choices),
  }
}

function pollEvent(poll: Record<string, unknown>, videoId: string, now: number): ChatEventRecord {
  const snapshot = readPoll(poll)
  const author = snapshot.metadata?.split('•')[0]?.trim() || null
  return {
    seq: 0,
    video: videoId,
    at: now,
    // 更新包通常不带 header；投票只有主播能发起，缺省按 owner 处理。
    type: snapshot.question ? 'poll' : 'pollUpdate',
    owner: snapshot.pollType == null || snapshot.pollType === 'LIVE_CHAT_POLL_TYPE_CREATOR',
    ...(author ? { author } : {}),
    text: snapshot.question,
    id: `poll:${snapshot.pollKey}`,
    data: {
      pollKey: snapshot.pollKey,
      snapshotKey: snapshot.snapshotKey,
      pollType: snapshot.pollType,
      metadata: snapshot.metadata,
      choices: snapshot.choices,
    },
    raw: poll,
  }
}

function bannerEvent(
  banner: Record<string, unknown>,
  videoId: string,
  now: number,
  emojis?: Map<string, ChatEmoji>,
): ChatEventRecord {
  const header = asRecord(asRecord(banner.header)?.liveChatBannerHeaderRenderer)
  const headerText = readMessageText(header?.text)
  const pinned = asRecord(banner.contents)
  const message = pinned ? toRecord(pinned as ChatItemWrapper, videoId, 0, emojis) : null
  const pinnedText = message?.msg.text?.trim() || null
  const actor = headerText?.replace(/^Pinned by\s*/i, '').trim() || null
  const at = timestampUsToSec(message?.msg.timestampUs) ?? now
  return {
    seq: 0,
    video: videoId,
    at,
    type: 'banner',
    owner: true,
    ...(actor ? { author: actor } : {}),
    text: pinnedText
      ? `置顶 ${message?.msg.author ?? actor ?? ''}：${pinnedText}`
      : headerText,
    id: `banner:${String(banner.targetId ?? '')}:${(pinnedText ?? headerText ?? '').slice(0, 80)}`,
    data: {
      header: headerText,
      pinnedAuthor: message?.msg.author ?? null,
      pinnedAuthorId: message?.msg.authorId ?? null,
      pinnedKind: message?.msg.kind ?? null,
      pinnedEmojis: message?.msg.emoji?.map(emoji => emoji.id) ?? [],
      targetId: banner.targetId ?? null,
      actionId: banner.actionId ?? null,
    },
    raw: banner,
  }
}

/**
 * 从一轮轮询响应里提取非消息事件（以及极少数直接挂载的消息 renderer）。
 * `now` 用秒，只给没有时间戳的事件（投票更新、删除动作）兜底。
 */
export function extractChatEvents(
  payload: unknown,
  videoId: string,
  options: { now?: number, emojis?: Map<string, ChatEmoji> } = {},
): ExtractedEvents {
  const now = options.now ?? Math.round(Date.now() / 1000)
  const events: ChatEventRecord[] = []
  const messages: ChatRecord[] = []
  const skipped: Record<string, number> = {}
  const skip = (kind: string): void => {
    skipped[kind] = (skipped[kind] ?? 0) + 1
  }

  const push = (event: ChatEventRecord | null): void => {
    if (event)
      events.push(event)
  }

  for (const action of pollActions(payload)) {
    const record = asRecord(action)
    if (!record)
      continue

    // addChatItemAction 里偶尔也会出现非消息 renderer（系统提示、模式变更等）；
    // 消息 renderer 交给 extractChatItems，这里只收「不是消息」的项。
    const entries: [string, unknown][] = []
    const collectItem = (item: unknown): void => {
      const recordItem = asRecord(item)
      if (!recordItem)
        return
      for (const [key, value] of Object.entries(recordItem)) {
        if (MESSAGE_RENDERERS.has(key) || UI_RENDERERS.has(key) || METADATA_KEYS.has(key))
          continue
        entries.push([key, value])
      }
    }
    for (const [key, value] of Object.entries(record)) {
      if (key === 'addChatItemAction') {
        collectItem(asRecord(value)?.item)
        continue
      }
      if (key === 'replayChatItemAction') {
        for (const inner of asArray(asRecord(value)?.actions))
          collectItem(asRecord(asRecord(inner)?.addChatItemAction)?.item)
        continue
      }
      entries.push([key, value])
    }

    for (const [key, value] of entries) {
      if (METADATA_KEYS.has(key))
        continue
      if (key === 'addLiveChatTickerItemAction' || key.startsWith('liveChatTicker')) {
        skip(key)
        continue
      }

      if (MESSAGE_RENDERERS.has(key)) {
        const message = toRecord({ [key]: value } as ChatItemWrapper, videoId, 0, options.emojis)
        if (message)
          messages.push(message)
        else
          skip(key)
        continue
      }
      if (UI_RENDERERS.has(key)) {
        skip(key)
        continue
      }

      if (key === 'addBannerToLiveChatCommand') {
        const banner = asRecord(asRecord(asRecord(value)?.bannerRenderer)?.liveChatBannerRenderer)
        push(banner ? bannerEvent(banner, videoId, now, options.emojis) : null)
        // 置顶里也可能直接挂一个投票。
        const poll = asRecord(asRecord(banner?.contents)?.pollRenderer)
        if (poll)
          push(pollEvent(poll, videoId, now))
        continue
      }

      if (key === 'removeBannerForLiveChatCommand') {
        const targetId = String(asRecord(value)?.targetId ?? '')
        events.push({
          seq: 0,
          video: videoId,
          at: now,
          type: 'bannerRemoved',
          owner: true,
          text: null,
          id: `bannerRemoved:${targetId}`,
          data: { targetId },
          raw: value,
        })
        continue
      }

      if (key === 'showLiveChatActionPanelAction') {
        const panel = asRecord(
          asRecord(asRecord(value)?.panelToShow)?.liveChatActionPanelRenderer,
        )
        const contents = asRecord(panel?.contents)
        const poll = asRecord(contents?.pollRenderer)
        if (poll) {
          push(pollEvent(poll, videoId, now))
        }
        else if (contents) {
          events.push({
            seq: 0,
            video: videoId,
            at: now,
            type: 'panel',
            owner: false,
            text: pickText(contents),
            id: `panel:${String(panel?.id ?? '')}`,
            data: { panelId: panel?.id ?? null },
            raw: contents,
          })
        }
        continue
      }

      if (key === 'updateLiveChatPollAction') {
        const poll = asRecord(asRecord(asRecord(value)?.pollToUpdate)?.pollRenderer)
        if (poll)
          push(pollEvent(poll, videoId, now))
        continue
      }

      if (key === 'markChatItemAsDeletedAction' || key === 'removeChatItemAction') {
        const targetId = String(asRecord(value)?.targetItemId ?? '')
        events.push({
          seq: 0,
          video: videoId,
          at: now,
          type: 'deleted',
          owner: false,
          text: null,
          id: `deleted:${targetId}`,
          data: { targetItemId: targetId, action: key },
          raw: value,
        })
        continue
      }

      if (key === 'markChatItemsByAuthorAsDeletedAction' || key === 'removeChatItemByAuthorAction') {
        const authorId = String(asRecord(value)?.externalChannelId ?? '')
        events.push({
          seq: 0,
          video: videoId,
          at: now,
          type: 'deletedAuthor',
          owner: false,
          text: null,
          id: `deletedAuthor:${authorId}`,
          data: { authorId, action: key },
          raw: value,
        })
        continue
      }

      if (key === 'replaceChatItemAction') {
        const replacement = asRecord(asRecord(value)?.replacementItem)
        const message = replacement
          ? toRecord(replacement as ChatItemWrapper, videoId, 0, options.emojis)
          : null
        const targetId = String(asRecord(value)?.targetItemId ?? '')
        events.push({
          seq: 0,
          video: videoId,
          at: now,
          type: 'replaced',
          owner: false,
          ...(message?.msg.author ? { author: message.msg.author } : {}),
          ...(message?.msg.authorId ? { authorId: message.msg.authorId } : {}),
          text: message?.msg.text ?? null,
          id: `replace:${targetId}`,
          data: {
            targetItemId: targetId,
            kind: message?.msg.kind ?? null,
            emojis: message?.msg.emoji?.map(emoji => emoji.id) ?? [],
          },
          raw: value,
        })
        continue
      }

      if (key === 'liveChatBannerRenderer') {
        const banner = asRecord(value)
        push(banner ? bannerEvent(banner, videoId, now, options.emojis) : null)
        continue
      }

      if (key === 'pollRenderer') {
        const poll = asRecord(value)
        if (poll)
          push(pollEvent(poll, videoId, now))
        continue
      }

      const renderer = asRecord(value)
      if (key === 'liveChatViewerEngagementMessageRenderer') {
        events.push({
          seq: 0,
          video: videoId,
          at: atOf(renderer, now),
          type: 'system',
          owner: false,
          text: readMessageText(renderer?.message),
          ...(typeof renderer?.id === 'string' ? { id: `system:${renderer.id}` } : {}),
          data: { iconType: asRecord(renderer?.icon)?.iconType ?? null },
          raw: value,
        })
        continue
      }

      if (key === 'liveChatModeChangeMessageRenderer') {
        events.push({
          seq: 0,
          video: videoId,
          at: atOf(renderer, now),
          type: 'modeChange',
          owner: false,
          text: readMessageText(renderer?.subtext) ?? readMessageText(renderer?.message),
          ...(typeof renderer?.id === 'string' ? { id: `mode:${renderer.id}` } : {}),
          data: { iconType: asRecord(renderer?.icon)?.iconType ?? null },
          raw: value,
        })
        continue
      }

      if (key === 'liveChatCallForQuestionsRenderer' || key === 'liveChatCreatorAnswersQuestionsRenderer') {
        events.push({
          seq: 0,
          video: videoId,
          at: atOf(renderer, now),
          type: 'qna',
          owner: true,
          text: pickText(renderer ?? {}),
          ...(typeof renderer?.id === 'string' ? { id: `qna:${renderer.id}` } : {}),
          raw: value,
        })
        continue
      }

      if (key === 'liveChatProductItemRenderer') {
        events.push({
          seq: 0,
          video: videoId,
          at: atOf(renderer, now),
          type: 'product',
          owner: true,
          text: pickText(renderer ?? {}),
          ...(typeof renderer?.id === 'string' ? { id: `product:${renderer.id}` } : {}),
          raw: value,
        })
        continue
      }

      if (renderer) {
        events.push({
          seq: 0,
          video: videoId,
          at: atOf(renderer, now),
          type: 'other',
          owner: false,
          text: pickText(renderer),
          id: `other:${key}:${typeof renderer.id === 'string' ? renderer.id : ''}`,
          raw: value,
        })
        continue
      }

      skip(key)
    }
  }

  return { events, messages, skipped }
}

/** 事件去重键：投票按快照算，其余按稳定 id。 */
export function chatEventKey(
  event: Pick<ChatEventRecord, 'type' | 'id' | 'data' | 'text'>,
): string {
  const base = event.id ?? `${event.type}:${event.text ?? ''}`
  if (event.type === 'poll' || event.type === 'pollUpdate') {
    const snapshot = typeof event.data?.snapshotKey === 'string' ? event.data.snapshotKey : ''
    return `${base}|${snapshot}`
  }
  return base
}
