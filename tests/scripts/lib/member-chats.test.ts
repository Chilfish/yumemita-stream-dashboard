import { describe, expect, it } from 'vitest'
import {
  chatTimestamp,
  collectMemberChats,
  memberChannelMap,
} from '@scripts/lib/member-chats.ts'
import type { ChatRecord } from '@scripts/lib/live-chat.ts'

const sources = [
  { id: 'nonoka', label: '宮永ののか', channelId: 'UCnonoka' },
  { id: 'ritsu', label: '峰月律', channelId: 'UCritsu' },
  { id: 'yuno', label: '千石ユノ', channelId: 'UCyuno' },
]

function record(overrides: Partial<ChatRecord['msg']> & { ts?: number } = {}): ChatRecord {
  const { ts = 1_700_000_000, ...msg } = overrides
  return {
    seq: 1,
    video: 'vid',
    ts,
    msg: {
      author: '@spectator',
      authorId: 'UCspectator',
      kind: 'text',
      text: '',
      ...msg,
    },
  } as ChatRecord
}

describe('memberChannelMap', () => {
  it('排除本场主播，忽略没有 channelId 的成员', () => {
    const map = memberChannelMap([...sources, { id: 'unknown', label: '未知' }], 'UCritsu')
    expect([...map.keys()].sort()).toEqual(['UCnonoka', 'UCyuno'])
    expect(map.get('UCyuno')).toEqual({ id: 'yuno', label: '千石ユノ' })
  })

  it('未知主播频道的旧场次不排除任何人', () => {
    const map = memberChannelMap(sources, null)
    expect(map.size).toBe(3)
  })
})

describe('collectMemberChats', () => {
  it('只收其他成员，保留时间顺序与 kind', () => {
    const timed = [
      { record: record({ authorId: 'UCspectator' }), at: 1 },
      { record: record({ authorId: 'UCyuno', author: '@yuno_yumemita', text: 'うわ…' }), at: 2 },
      { record: record({ authorId: 'UCritsu', author: '@ritsu_yumemita', text: 'あすけん！？' }), at: 3 },
      { record: record({ authorId: 'UCnonoka', kind: 'superchat', sc: '¥500', text: 'かわいい' }), at: 4 },
      { record: record({ authorId: 'UCyuno', kind: 'giftRedemption', text: 'received a gift' }), at: 5 },
    ]
    const chats = collectMemberChats(timed, memberChannelMap(sources, 'UCritsu'))
    expect(chats.map(chat => chat.memberId)).toEqual(['yuno', 'nonoka', 'yuno'])
    expect(chats[0]).toMatchObject({ memberLabel: '千石ユノ', author: '@yuno_yumemita', kind: 'text' })
    expect(chats[1]).toMatchObject({ memberId: 'nonoka', kind: 'superchat', text: 'かわいい' })
    expect(chats[2]?.kind).toBe('membership')
    expect(chats[0]?.at).toMatch(/\+09:00$/)
  })

  it('没有 authorId 的旧记录不猜身份', () => {
    const timed = [
      { record: record({ authorId: undefined, author: '@yuno_yumemita', text: 'hello' }), at: 1 },
    ]
    expect(collectMemberChats(timed, memberChannelMap(sources, 'UCritsu'))).toEqual([])
  })

  it('没有可识别成员时直接返回空数组', () => {
    const timed = [{ record: record({ authorId: 'UCyuno', text: 'hi' }), at: 1 }]
    expect(collectMemberChats(timed, new Map())).toEqual([])
  })

  it('会员消息正文为空时回退 header', () => {
    const timed = [
      { record: record({ authorId: 'UCyuno', kind: 'membership', header: 'Member for 2 months' }), at: 1 },
    ]
    const [chat] = collectMemberChats(timed, memberChannelMap(sources, 'UCritsu'))
    expect(chat?.text).toBe('Member for 2 months')
  })
})

describe('chatTimestamp', () => {
  it('优先 timestampUsec，缺失时回退 ts', () => {
    expect(chatTimestamp(record({ timestampUs: '1700000001000000' }))).toBe(1_700_000_001)
    expect(chatTimestamp(record({ ts: 1_700_000_002 }))).toBe(1_700_000_002)
  })
})
