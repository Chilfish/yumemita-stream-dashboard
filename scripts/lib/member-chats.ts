/**
 * 团体成员在别人直播间的发言（`chat.memberChats`）。
 *
 * 身份只认 `authorExternalChannelId`（归一化后的 `msg.authorId`）：成员互相当频道版主，
 * 消息都带 `Moderator` 徽章，不能按徽章区分；显示名会改，也不能当主键。
 * 本场主播自己的频道要排除，他的消息仍归 `ownerChats`。
 */
import type { ChatRecord } from './live-chat.ts'
import type { MemberChat } from '@/types/datapack.ts'
import { jstIso } from './jst.ts'

export interface MemberSource {
  id: string
  label: string
  channelId?: string | null
}

export type MemberChannelMap = Map<string, { id: string, label: string }>

/** `authorId` → 成员；排除本场主播的频道。 */
export function memberChannelMap(
  sources: readonly MemberSource[],
  hostChannelId: string | null | undefined,
): MemberChannelMap {
  const map: MemberChannelMap = new Map()
  for (const source of sources) {
    if (!source.channelId || source.channelId === hostChannelId)
      continue
    if (!map.has(source.channelId))
      map.set(source.channelId, { id: source.id, label: source.label })
  }
  return map
}

/** 消息时间优先用 `timestampUsec`，旧档回退归一化时写入的 `ts`。 */
export function chatTimestamp(record: ChatRecord): number | null {
  const us = record.msg.timestampUs
  if (us != null) {
    const n = Number(us) / 1_000_000
    if (Number.isFinite(n))
      return n
  }
  return typeof record.ts === 'number' ? record.ts : null
}

/**
 * 从已按时间排好序的记录里挑出其他成员的发言，保持时间顺序。
 * 没有 `authorId` 的旧记录无法确认身份，跳过。
 */
export function collectMemberChats(
  timed: readonly { record: ChatRecord, at: number }[],
  channels: MemberChannelMap,
): MemberChat[] {
  if (channels.size === 0)
    return []
  const chats: MemberChat[] = []
  for (const { record, at } of timed) {
    const authorId = record.msg.authorId
    if (!authorId)
      continue
    const member = channels.get(authorId)
    if (!member)
      continue
    const rawKind = record.msg.kind ?? 'text'
    const kind = rawKind === 'giftRedemption' ? 'membership' : rawKind
    const emojis = record.msg.emoji?.map(item => item.id) ?? []
    chats.push({
      at: jstIso(at),
      memberId: member.id,
      memberLabel: member.label,
      author: record.msg.author ?? authorId,
      authorId,
      kind: kind === 'superchat' || kind === 'sticker' || kind === 'membership' || kind === 'gift' ? kind : 'text',
      text: (record.msg.text ?? '').trim() || (record.msg.header ?? '').trim(),
      ...(emojis.length ? { emojis } : {}),
    })
  }
  return chats
}
