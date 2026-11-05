import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeLiveChat } from './live-chat'

function chatLine(item: unknown): string {
  return JSON.stringify({
    replayChatItemAction: { actions: [{ addChatItemAction: { item } }] },
  })
}

const fixture = [
  chatLine({
    liveChatTextMessageRenderer: {
      timestampUsec: '1774876000000000',
      authorExternalChannelId: 'UCtext',
      authorName: { simpleText: '@viewer' },
      message: {
        runs: [
          { text: 'hello ' },
          {
            emoji: {
              emojiId: 'UC99kOG6_9RD0mR3OG4EOfxw/54y5aNPZFd-QoPwPxrGNqQk',
              isCustomEmoji: true,
              shortcuts: [':_YUNOlove:'],
              image: {
                thumbnails: [
                  { url: 'https://yt3.ggpht.com/x=w24-h24', width: 24 },
                  { url: 'https://yt3.ggpht.com/x=w48-h48', width: 48 },
                ],
                accessibility: { accessibilityData: { label: 'YUNOlove' } },
              },
            },
          },
        ],
      },
    },
  }),
  chatLine({
    liveChatMembershipItemRenderer: {
      timestampUsec: '1774876274043141',
      authorExternalChannelId: 'UCmember',
      authorName: { simpleText: '@member' },
      headerSubtext: { runs: [{ text: 'Welcome to ' }, { text: "YUNO's＋" }, { text: '!' }] },
    },
  }),
  chatLine({
    liveChatSponsorshipsGiftPurchaseAnnouncementRenderer: {
      timestampUsec: '1774879777816984',
      authorExternalChannelId: 'UCgifter',
      header: {
        liveChatSponsorshipsHeaderRenderer: {
          authorName: { simpleText: '@香港のてんかわ' },
          primaryText: {
            runs: [
              { text: 'Sent ' },
              { text: '50' },
              { text: ' ' },
              { text: '千石ユノ -Sengoku Yuno- / 夢限大みゅーたいぷ' },
              { text: ' gift memberships' },
            ],
          },
        },
      },
    },
  }),
  chatLine({
    liveChatSponsorshipsGiftRedemptionAnnouncementRenderer: {
      timestampUsec: '1774878597717049',
      authorExternalChannelId: 'UCrecipient',
      authorName: { simpleText: '@saigoarashi5895' },
      message: {
        runs: [
          { text: 'received a gift membership by ', italics: true },
          { text: '@steinberg11', bold: true, italics: true },
        ],
      },
    },
  }),
  chatLine({ liveChatViewerEngagementMessageRenderer: {} }),
]

describe('normalizeLiveChat', () => {
  it('keeps gift purchases and redemptions instead of skipping them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-chat-'))
    const input = join(dir, 'mja4111zqIk.live_chat.json')
    const output = join(dir, 'danmaku_mja4111zqIk.jsonl')
    writeFileSync(input, fixture.join('\n'), 'utf8')

    const result = await normalizeLiveChat(input, output, 'mja4111zqIk')

    expect(result.counts).toEqual({
      text: 1,
      superchat: 0,
      sticker: 0,
      membership: 1,
      gift: 1,
      giftRedemption: 1,
    })
    expect(result.total).toBe(4)
    expect(result.skipped).toBe(1)
    expect(result.skippedKinds).toEqual({ liveChatViewerEngagementMessageRenderer: 1 })
    expect(result.emojis).toBe(1)

    const records = readFileSync(output, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as {
        ts: number
        msg: {
          kind: string
          author?: string
          authorId?: string
          text?: string
          header?: string
          giftCount?: number
          emoji?: { id: string }[]
        }
      })

    const gift = records.find(record => record.msg.kind === 'gift')!
    expect(gift.msg.author).toBe('@香港のてんかわ')
    expect(gift.msg.authorId).toBe('UCgifter')
    expect(gift.msg.giftCount).toBe(50)
    expect(gift.msg.text).toContain('Sent 50')
    expect(gift.ts).toBe(1774879778)

    const redemption = records.find(record => record.msg.kind === 'giftRedemption')!
    expect(redemption.msg.author).toBe('@saigoarashi5895')
    expect(redemption.msg.text).toBe('received a gift membership by @steinberg11')

    const membership = records.find(record => record.msg.kind === 'membership')!
    expect(membership.msg.text).toBe('')
    expect(membership.msg.header).toBe("Welcome to YUNO's＋!")

    const text = records.find(record => record.msg.kind === 'text')!
    expect(text.msg.emoji).toEqual([{ id: 'UC99kOG6_9RD0mR3OG4EOfxw/54y5aNPZFd-QoPwPxrGNqQk' }])

    const sidecar = JSON.parse(readFileSync(join(dir, 'emoji_mja4111zqIk.json'), 'utf8')) as {
      schema: string
      emojis: { id: string, name: string | null, url: string }[]
    }
    expect(sidecar.schema).toBe('yumemita.chat-emoji/v1')
    expect(sidecar.emojis).toEqual([
      {
        id: 'UC99kOG6_9RD0mR3OG4EOfxw/54y5aNPZFd-QoPwPxrGNqQk',
        name: 'YUNOlove',
        url: 'https://yt3.ggpht.com/x=w48-h48',
      },
    ])
  })

  it('does not drop emoji assets already collected from live chat', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-chat-merge-'))
    const input = join(dir, 'merge.live_chat.json')
    const output = join(dir, 'danmaku_merge.jsonl')
    writeFileSync(input, fixture.join('\n'), 'utf8')
    writeFileSync(join(dir, 'emoji_merge.json'), JSON.stringify({
      schema: 'yumemita.chat-emoji/v1',
      emojis: [{ id: 'UC99kOG6_9RD0mR3OG4EOfxw/preRoll', name: 'preRoll', url: 'https://example/pre.png' }],
    }), 'utf8')

    await normalizeLiveChat(input, output, 'merge')

    const sidecar = JSON.parse(readFileSync(join(dir, 'emoji_merge.json'), 'utf8')) as {
      emojis: { id: string }[]
    }
    expect(sidecar.emojis.map(emoji => emoji.id)).toEqual([
      'UC99kOG6_9RD0mR3OG4EOfxw/54y5aNPZFd-QoPwPxrGNqQk',
      'UC99kOG6_9RD0mR3OG4EOfxw/preRoll',
    ])
  })

  it('同一份 yt-dlp 字幕里直播段与回放段重复时按 rendererId 去重', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-chat-dedupe-'))
    const input = join(dir, 'dedupe.live_chat.json')
    const output = join(dir, 'danmaku_dedupe.jsonl')
    const sc = chatLine({
      liveChatPaidMessageRenderer: {
        id: 'SC-DUP',
        timestampUsec: '1774876000000000',
        authorName: { simpleText: '@sc' },
        purchaseAmountText: { simpleText: '¥500' },
        message: { runs: [{ text: 'hi' }] },
      },
    })
    const text = chatLine({
      liveChatTextMessageRenderer: {
        id: 'TEXT-DUP',
        timestampUsec: '1774876001000000',
        authorName: { simpleText: '@viewer' },
        message: { runs: [{ text: 'hello' }] },
      },
    })
    writeFileSync(input, [sc, text, sc, text].join('\n'), 'utf8')

    const result = await normalizeLiveChat(input, output, 'dedupe')

    expect(result.duplicates).toBe(2)
    expect(result.total).toBe(2)
    expect(result.counts.superchat).toBe(1)
    expect(result.counts.text).toBe(1)

    const records = readFileSync(output, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as { rendererId?: string })
    expect(records.map(record => record.rendererId)).toEqual(['SC-DUP', 'TEXT-DUP'])
  })

  it('会员留言按普通弹幕处理，并保留 SC 颜色 / 贴纸资源', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-chat-paid-'))
    const input = join(dir, 'paid.live_chat.json')
    const output = join(dir, 'danmaku_paid.jsonl')
    writeFileSync(input, [
      chatLine({
        liveChatMembershipItemRenderer: {
          id: 'MEMBER1',
          timestampUsec: '1774876000000000',
          authorName: { simpleText: '@member' },
          headerPrimaryText: { runs: [{ text: 'Member for ' }, { text: '25' }, { text: ' months' }] },
          headerSubtext: { simpleText: 'もぐもぐ' },
          message: { runs: [{ text: '今月もよろしくお願いします' }] },
        },
      }),
      chatLine({
        liveChatPaidMessageRenderer: {
          id: 'SC1',
          timestampUsec: '1774876001000000',
          authorName: { simpleText: '@sc' },
          purchaseAmountText: { simpleText: '¥500' },
          message: { runs: [{ text: 'hi' }] },
          headerBackgroundColor: 4294947584,
          headerTextColor: 4278190080,
          bodyBackgroundColor: 4294953512,
          bodyTextColor: 4278190080,
          authorNameTextColor: 2315255808,
          timestampColor: 2147483648,
        },
      }),
      chatLine({
        liveChatPaidStickerRenderer: {
          id: 'STICKER1',
          timestampUsec: '1774876002000000',
          authorName: { simpleText: '@sticker' },
          purchaseAmountText: { simpleText: '¥140' },
          sticker: {
            thumbnails: [{ url: '//lh3.googleusercontent.com/cake=s40-rp', width: 40, height: 40 }],
            accessibility: { accessibilityData: { label: 'cake' } },
          },
          moneyChipBackgroundColor: 4280150454,
          moneyChipTextColor: 4278190080,
          backgroundColor: 4280150454,
        },
      }),
    ].join('\n'), 'utf8')

    await normalizeLiveChat(input, output, 'paid')

    const records = readFileSync(output, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as {
        rendererId?: string
        msg: {
          kind: string
          memberMessage?: boolean
          header?: string
          membershipPrimary?: string
          colors?: Record<string, number>
          sticker?: { name: string | null, url: string }
        }
      })

    const member = records.find(record => record.rendererId === 'MEMBER1')!
    expect(member.msg.kind).toBe('text')
    expect(member.msg.memberMessage).toBe(true)
    expect(member.msg.header).toBe('もぐもぐ')
    expect(member.msg.membershipPrimary).toBe('Member for 25 months')

    const sc = records.find(record => record.rendererId === 'SC1')!
    expect(sc.msg.colors).toMatchObject({
      headerBackground: 4294947584,
      bodyBackground: 4294953512,
      authorName: 2315255808,
    })

    const sticker = records.find(record => record.rendererId === 'STICKER1')!
    expect(sticker.msg.sticker).toEqual({
      name: 'cake',
      url: 'https://lh3.googleusercontent.com/cake=s40-rp',
    })
    expect(sticker.msg.colors).toMatchObject({ moneyChipBackground: 4280150454 })
  })
})
