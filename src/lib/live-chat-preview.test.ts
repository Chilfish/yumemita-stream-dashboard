import { describe, expect, it } from 'vitest'
import {
  buildImportedSession,
  buildPreviewSession,
  chatKindLabel,
  eventTypeLabel,
  parseJsonLines,
  type PreviewSessionMeta,
} from './live-chat-preview'

const meta: PreviewSessionMeta = {
  id: '2026-11-04_label_vid',
  videoId: 'vid',
  datasetId: 'yuno',
  label: 'label',
  title: 'title',
  startedAt: '2026-11-04T12:00:00+00:00',
  dir: '/tmp/session',
  updatedAt: '2026-11-04T03:43:00.000Z',
  files: { messages: 'danmaku_live_vid.jsonl', events: 'events_vid.jsonl', emoji: 'emoji_vid.json', state: null, meta: null },
  status: { playability: 'LIVE_STREAM_OFFLINE' },
}

describe('parseJsonLines', () => {
  it('跳过坏行', () => {
    const { rows, invalid } = parseJsonLines('{"a":1}\nbroken\n[1]\n')
    expect(rows).toEqual([{ a: 1 }])
    expect(invalid).toBe(2)
  })
})

describe('buildPreviewSession', () => {
  it('合并消息与事件、按时间排序并统计', () => {
    const messages = [
      { seq: 1, ts: 100, rendererId: 'M1', msg: { author: '@viewer', authorId: 'UC1', text: 'hello', kind: 'text', emoji: [{ id: 'UC/hash' }] } },
      { seq: 2, ts: 90, rendererId: 'M0', msg: { author: '@owner', authorId: 'UC0', text: 'hi', kind: 'text', badges: ['Owner'] } },
    ]
    const events = [
      { seq: 1, at: 95, type: 'poll', owner: true, author: '@owner', authorId: 'UC0', text: 'Q', data: { choices: [{ text: 'A', percentage: '50%' }] } },
    ]
    const emojis = { schema: 'yumemite.chat-emoji/v1', emojis: [{ id: 'UC/hash', name: 'hash', url: 'https://example/x.png' }] }

    const session = buildPreviewSession({
      meta,
      messagesText: messages.map(row => JSON.stringify(row)).join('\n'),
      eventsText: events.map(row => JSON.stringify(row)).join('\n'),
      emojiText: JSON.stringify(emojis),
    })

    expect(session.rows.map(row => row.kind === 'message' ? row.rendererId : row.type)).toEqual(['M0', 'poll', 'M1'])
    expect(session.counts).toMatchObject({
      messages: 2,
      events: 1,
      byKind: { text: 2 },
      byEvent: { poll: 1 },
      uniqueAuthors: 2,
      ownerMessages: 1,
      ownerEvents: 1,
      emojiDistinct: 1,
      firstTs: 90,
      lastTs: 100,
      spanSec: 10,
    })

    const viewer = session.rows.find(row => row.kind === 'message' && row.rendererId === 'M1')
    expect(viewer?.kind === 'message' ? viewer.emojis : []).toEqual([
      { id: 'UC/hash', name: 'hash', url: 'https://example/x.png' },
    ])
  })

  it('没有 rendererId 的旧档按时间保留', () => {
    const session = buildPreviewSession({
      meta,
      messagesText: JSON.stringify({ ts: 10, msg: { author: '@a', text: 'x', kind: 'text' } }),
      eventsText: '',
      emojiText: null,
    })
    expect(session.rows).toHaveLength(1)
    expect(session.counts.firstTs).toBe(10)
  })

  it('会员留言归为普通弹幕，同时保留会员文案', () => {
    const session = buildPreviewSession({
      meta,
      messagesText: JSON.stringify({
        ts: 10,
        msg: {
          author: '@member',
          text: '今月もよろしくお願いします',
          kind: 'membership',
          badges: ['Member (2 years)'],
          header: 'もぐもぐ',
          membershipPrimary: 'Member for 25 months',
        },
      }),
      eventsText: '',
      emojiText: null,
    })
    const row = session.rows[0]
    expect(row?.kind).toBe('message')
    if (row?.kind !== 'message')
      throw new Error('expected message')
    expect(row.chatKind).toBe('text')
    expect(row.memberMessage).toBe(true)
    expect(row.header).toBe('もぐもぐ')
    expect(row.membershipPrimary).toBe('Member for 25 months')
    expect(session.counts.byKind.membership).toBeUndefined()
    expect(session.counts.byKind.text).toBe(1)
  })

  it('同一投票的多次快照合并成一条，保留最新结果', () => {
    const poll = (percentage: string, at: number) => JSON.stringify({
      at,
      type: 'pollUpdate',
      owner: true,
      author: '@owner',
      text: null,
      data: {
        pollKey: 'birthday',
        metadata: '380 votes',
        choices: [{ text: 'おめでとう', percentage }],
      },
    })
    const session = buildPreviewSession({
      meta,
      messagesText: '',
      eventsText: [poll('25%', 10), poll('70%', 20)].join('\n'),
      emojiText: null,
    })
    expect(session.counts.events).toBe(1)
    const event = session.rows[0]
    expect(event?.kind).toBe('event')
    if (event?.kind !== 'event')
      throw new Error('expected event')
    expect(event.data?.snapshotCount).toBe(2)
    expect(event.data?.updatedAtTs).toBe(20)
    const choices = event.data?.choices
    expect(Array.isArray(choices)).toBe(true)
    expect((choices as { percentage: string }[])[0]?.percentage).toBe('70%')
  })

  it('保留 SC 颜色与付费贴纸资源', () => {
    const session = buildPreviewSession({
      meta,
      messagesText: [
        JSON.stringify({ ts: 1, msg: { author: '@sc', text: 'hi', kind: 'superchat', sc: '¥500', colors: { headerBackground: 4294947584 } } }),
        JSON.stringify({ ts: 2, msg: { author: '@sticker', text: '', kind: 'sticker', sc: '¥140', sticker: { name: 'cake', url: 'https://example/cake.png' } } }),
      ].join('\n'),
      eventsText: '',
      emojiText: null,
    })
    const sc = session.rows[0]
    const sticker = session.rows[1]
    expect(sc?.kind === 'message' ? sc.colors?.headerBackground : null).toBe(4294947584)
    expect(sticker?.kind === 'message' ? sticker.sticker : null).toEqual({ name: 'cake', url: 'https://example/cake.png' })
  })
})

describe('buildImportedSession', () => {
  it('自动区分消息与事件行', () => {
    const text = [
      JSON.stringify({ seq: 1, video: 'vid', ts: 10, msg: { author: '@a', text: 'hello', kind: 'text' } }),
      JSON.stringify({ at: 11, type: 'system', owner: false, text: 'Welcome' }),
    ].join('\n')
    const session = buildImportedSession('imported.jsonl', text)
    expect(session.videoId).toBe('vid')
    expect(session.counts.messages).toBe(1)
    expect(session.counts.events).toBe(1)
    expect(session.rows).toHaveLength(2)
  })

  it('没有可识别行时报错', () => {
    expect(() => buildImportedSession('empty.jsonl', '{"foo":1}\n')).toThrow('没有识别到')
  })
})

describe('labels', () => {
  it('未知类型回退到原值', () => {
    expect(chatKindLabel('superchat')).toBe('Super Chat')
    expect(chatKindLabel('unknown')).toBe('unknown')
    expect(eventTypeLabel('poll')).toBe('投票')
    expect(eventTypeLabel('unknown')).toBe('unknown')
  })
})
