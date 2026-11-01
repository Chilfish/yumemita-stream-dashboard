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
      message: { runs: [{ text: 'hello' }] },
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
          giftCount?: number
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

    expect(records.find(record => record.msg.kind === 'membership')!.msg.text).toBe('')
  })
})
