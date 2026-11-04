import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  classifyChatError,
  classifyWatchStatus,
  extractChatItems,
  extractPollContinuation,
  extractReplayContinuation,
  extractWatchPage,
  netscapeCookieHeader,
  parseWatchStatus,
  pollDelayMs,
  selectContinuation,
  type WatchStatus,
} from './innertube-live.ts'
import { chatEventKey, extractChatEvents } from './live-chat-events.ts'

function watchHtml(data: unknown, player: unknown): string {
  return `<html><script>var ytInitialData = ${JSON.stringify(data)};</script><script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script></html>`
}

function status(overrides: Partial<WatchStatus>): WatchStatus {
  return {
    playability: 'OK',
    reason: null,
    isLiveNow: null,
    endTimestamp: null,
    startTimestamp: null,
    lengthSeconds: null,
    isReplay: null,
    availabilityMessage: null,
    availability: null,
    ...overrides,
  }
}

describe('continuation', () => {
  it('等待室优先 reload，而不是 timed', () => {
    const continuation = selectContinuation([
      { timedContinuationData: { continuation: 'TIMED' } },
      { reloadContinuationData: { continuation: 'RELOAD' } },
    ])
    expect(continuation).toEqual({ token: 'RELOAD', kind: 'reload' })
  })

  it('只有 timed 时退回 timed', () => {
    expect(extractPollContinuation({
      continuationContents: {
        liveChatContinuation: {
          continuations: [{ timedContinuationData: { continuation: 'NEXT', timeoutMs: 9000 } }],
        },
      },
    })).toEqual({ token: 'NEXT', kind: 'timed' })
  })

  it('回放只认 liveChatReplayContinuationData，不拿 playerSeek 当续页', () => {
    const payload = {
      continuationContents: {
        liveChatContinuation: {
          continuations: [
            { playerSeekContinuationData: { continuation: 'SEEK' } },
            { liveChatReplayContinuationData: { continuation: 'REPLAY', timeUntilLastMessageMsec: 5000 } },
          ],
        },
      },
    }
    expect(extractReplayContinuation(payload)).toEqual({ token: 'REPLAY', waitMs: 5000 })
    expect(extractReplayContinuation({
      continuationContents: {
        liveChatContinuation: { continuations: [{ playerSeekContinuationData: { continuation: 'SEEK' } }] },
      },
    })).toBeNull()
  })

  it('轮询间隔按 timeoutMs 夹取', () => {
    const payload = {
      continuationContents: {
        liveChatContinuation: {
          continuations: [{ timedContinuationData: { continuation: 'N', timeoutMs: 9633 } }],
        },
      },
    }
    expect(pollDelayMs(payload)).toBe(9633)
    const slow = {
      continuationContents: {
        liveChatContinuation: {
          continuations: [{ timedContinuationData: { continuation: 'N', timeoutMs: 60_000 } }],
        },
      },
    }
    expect(pollDelayMs(slow)).toBe(15_000)
    expect(pollDelayMs({})).toBe(5000)
  })
})

describe('watch 页', () => {
  const waiting = {
    contents: {
      twoColumnWatchNextResults: {
        conversationBar: {
          liveChatRenderer: {
            continuations: [{ reloadContinuationData: { continuation: 'ROOM' } }],
          },
        },
      },
    },
  }
  const player = {
    playabilityStatus: {
      status: 'LIVE_STREAM_OFFLINE',
      reason: 'This live event will begin in 19 minutes.',
      liveStreamability: {
        liveStreamabilityRenderer: {
          offlineSlate: { liveStreamOfflineSlateRenderer: { scheduledStartTime: '1789821000' } },
        },
      },
    },
    videoDetails: { title: '待机中', channelId: 'UC123', author: 'Channel', lengthSeconds: '0' },
    microformat: {
      playerMicroformatRenderer: {
        liveBroadcastDetails: { isLiveNow: false, startTimestamp: '2026-09-19T12:30:00+00:00' },
      },
    },
  }

  it('等待室：取 reload token、排期与 pending', () => {
    const page = extractWatchPage(watchHtml(waiting, player))
    expect(page.continuation).toEqual({ token: 'ROOM', kind: 'reload' })
    expect(page.title).toBe('待机中')
    expect(page.channelId).toBe('UC123')
    expect(page.scheduledStart).toBe(1789821000)
    expect(classifyWatchStatus(parseWatchStatus(watchHtml(waiting, player)))).toBe('pending')
  })

  it('已结束优先于播放器受限', () => {
    expect(classifyWatchStatus(status({
      playability: 'LOGIN_REQUIRED',
      isReplay: true,
      isLiveNow: false,
      endTimestamp: '2026-09-19T14:00:00+00:00',
    }))).toBe('ended')
  })

  it('会员限定且未结束 → unplayable', () => {
    expect(classifyWatchStatus(status({
      playability: 'UNPLAYABLE',
      availability: 'subscriber_only',
      isLiveNow: false,
    }))).toBe('unplayable')
  })

  it('聊天被禁用单独识别', () => {
    expect(classifyWatchStatus(status({
      availabilityMessage: 'Chat is disabled for this live stream.',
    }))).toBe('chat_disabled')
  })
})

const chatPayload = {
  continuationContents: {
    liveChatContinuation: {
      actions: [
        {
          addChatItemAction: {
            item: {
              liveChatTextMessageRenderer: {
                id: 'TEXT1',
                timestampUsec: '1793761564000000',
                authorName: { simpleText: '@viewer' },
                authorExternalChannelId: 'UCVIEWER',
                message: {
                  runs: [
                    { text: 'おめでとう ' },
                    {
                      emoji: {
                        emojiId: 'UCCH/abc',
                        shortcuts: [':_hooray:'],
                        isCustomEmoji: true,
                        image: {
                          thumbnails: [
                            { url: 'https://example/24.png', width: 24 },
                            { url: 'https://example/48.png', width: 48 },
                          ],
                          accessibility: { accessibilityData: { label: 'hooray' } },
                        },
                      },
                    },
                  ],
                },
                authorBadges: [
                  { liveChatAuthorBadgeRenderer: { tooltip: 'Member (1 month)' } },
                ],
              },
            },
          },
        },
        {
          addChatItemAction: {
            item: {
              liveChatPaidMessageRenderer: {
                id: 'SC1',
                timestampUsec: '1793761565000000',
                authorName: { simpleText: '@sc' },
                purchaseAmountText: { simpleText: '¥500' },
                message: { runs: [{ text: 'great' }] },
              },
            },
          },
        },
        {
          addChatItemAction: {
            item: {
              liveChatPaidStickerRenderer: {
                id: 'STICKER1',
                timestampUsec: '1793761566000000',
                authorName: { simpleText: '@sticker' },
                purchaseAmountText: { simpleText: '¥300' },
                sticker: { accessibility: { accessibilityData: { label: 'dog' } } },
              },
            },
          },
        },
        {
          addChatItemAction: {
            item: {
              liveChatMembershipItemRenderer: {
                id: 'MEM1',
                timestampUsec: '1793761567000000',
                authorName: { simpleText: '@member' },
                headerSubtext: { runs: [{ text: 'Welcome to ' }, { text: 'Channel!' }] },
                authorBadges: [{ liveChatAuthorBadgeRenderer: { tooltip: 'New member' } }],
              },
            },
          },
        },
        {
          addChatItemAction: {
            item: {
              liveChatSponsorshipsGiftPurchaseAnnouncementRenderer: {
                id: 'GIFT1',
                timestampUsec: '1793761568000000',
                header: {
                  liveChatSponsorshipsHeaderRenderer: {
                    authorName: { simpleText: '@giver' },
                    primaryText: {
                      runs: [{ text: 'Sent ' }, { text: '5' }, { text: ' gift memberships' }],
                    },
                  },
                },
              },
            },
          },
        },
        {
          addChatItemAction: {
            item: {
              liveChatSponsorshipsGiftRedemptionAnnouncementRenderer: {
                id: 'RED1',
                timestampUsec: '1793761569000000',
                authorName: { simpleText: '@receiver' },
                message: { runs: [{ text: 'received a gift membership by @giver' }] },
              },
            },
          },
        },
        {
          liveChatViewerEngagementMessageRenderer: {
            id: 'ENG1',
            timestampUsec: '1793761570000000',
            message: { runs: [{ text: 'Welcome to live chat!' }] },
          },
        },
      ],
    },
  },
}

describe('消息提取', () => {
  it('覆盖六种消息并跳过系统提示', () => {
    const emojis = new Map()
    const { records } = extractChatItems(chatPayload, 'vid', emojis)
    expect(records.map(record => record.msg.kind)).toEqual([
      'text',
      'superchat',
      'sticker',
      'membership',
      'gift',
      'giftRedemption',
    ])
    // 系统提示不进消息流，由 extractChatEvents 记为 system 事件。
    const { events } = extractChatEvents(chatPayload, 'vid', { now: 1_800_000_000 })
    expect(events.map(event => event.type)).toEqual(['system'])
    expect(emojis.get('UCCH/abc')?.name).toBe('hooray')

    const text = records[0]!
    expect(text.rendererId).toBe('TEXT1')
    expect(text.msg.authorId).toBe('UCVIEWER')
    expect(text.msg.badges).toEqual(['Member'])
    expect(text.msg.emoji).toEqual([{ id: 'UCCH/abc' }])

    expect(records[1]!.msg.sc).toBe('¥500')
    expect(records[2]!.msg.sc).toBe('¥300')
    expect(records[3]!.msg.header).toBe('Welcome to Channel!')
    expect(records[4]!.msg.giftCount).toBe(5)
    expect(records[5]!.msg.author).toBe('@receiver')
  })
})

describe('非消息事件', () => {
  it('置顶公告保留为 owner 事件', () => {
    const { events } = extractChatEvents({
      continuationContents: {
        liveChatContinuation: {
          actions: [{
            addBannerToLiveChatCommand: {
              bannerRenderer: {
                liveChatBannerRenderer: {
                  targetId: 'PIN1',
                  actionId: 'ACT1',
                  header: {
                    liveChatBannerHeaderRenderer: {
                      text: { runs: [{ text: 'Pinned by ' }, { text: '@owner' }] },
                    },
                  },
                  contents: {
                    liveChatTextMessageRenderer: {
                      id: 'PIN1',
                      timestampUsec: '1793761564000000',
                      authorName: { simpleText: '@owner' },
                      message: { runs: [{ text: '本日21時から！' }] },
                    },
                  },
                },
              },
            },
          }],
        },
      },
    }, 'vid', { now: 1_800_000_000 })

    expect(events).toHaveLength(1)
    const banner = events[0]!
    expect(banner.type).toBe('banner')
    expect(banner.owner).toBe(true)
    expect(banner.text).toContain('本日21時から！')
    expect(banner.data?.pinnedAuthor).toBe('@owner')
    expect(banner.at).toBe(1793761564)
  })

  it('投票保留选项与快照，更新按快照去重', () => {
    const poll = {
      header: {
        pollHeaderRenderer: {
          pollQuestion: { runs: [{ text: 'ゆのちゃん、おたんじょうび' }] },
          metadataText: { runs: [{ text: '@yuno_yumemita' }, { text: ' • ' }, { text: '380 votes' }] },
          liveChatPollType: 'LIVE_CHAT_POLL_TYPE_CREATOR',
        },
      },
      choices: [
        { text: { runs: [{ text: 'おめでとう' }] }, votePercentage: { simpleText: '25%' } },
        { text: { runs: [{ text: 'おめでとうがらし' }] }, votePercentage: { simpleText: '12%' } },
      ],
    }
    const { events } = extractChatEvents({
      continuationContents: {
        liveChatContinuation: {
          actions: [
            { updateLiveChatPollAction: { pollToUpdate: { pollRenderer: poll } } },
            { updateLiveChatPollAction: { pollToUpdate: { pollRenderer: poll } } },
          ],
        },
      },
    }, 'vid', { now: 1_800_000_000 })

    expect(events).toHaveLength(2)
    const event = events[0]!
    expect(event.type).toBe('poll')
    expect(event.owner).toBe(true)
    expect(event.author).toBe('@yuno_yumemita')
    expect(event.text).toBe('ゆのちゃん、おたんじょうび')
    const choices = event.data?.choices
    expect(Array.isArray(choices)).toBe(true)
    expect((choices as unknown[]).length).toBe(2)
    expect(chatEventKey(events[0]!)).toBe(chatEventKey(events[1]!))
  })

  it('删除、系统提示与 ticker 分开处理', () => {
    const { events, skipped } = extractChatEvents({
      continuationContents: {
        liveChatContinuation: {
          actions: [
            { markChatItemAsDeletedAction: { targetItemId: 'X1' } },
            { removeChatItemAction: { targetItemId: 'X2' } },
            { removeChatItemByAuthorAction: { externalChannelId: 'UCBAD' } },
            { liveChatViewerEngagementMessageRenderer: { id: 'E1', message: { runs: [{ text: 'Welcome' }] } } },
            { addLiveChatTickerItemAction: { item: { liveChatTickerSponsorItemRenderer: { id: 'T1' } } } },
          ],
        },
      },
    }, 'vid', { now: 1_800_000_000 })

    expect(events.map(event => event.type)).toEqual(['deleted', 'deleted', 'deletedAuthor', 'system'])
    expect(events[1]!.data?.targetItemId).toBe('X2')
    expect(events[2]!.data?.authorId).toBe('UCBAD')
    expect(skipped.addLiveChatTickerItemAction).toBe(1)
    expect(events[3]!.id).toBe('system:E1')
  })
})

describe('错误分类与 cookie', () => {
  it('按文案与状态码分类', () => {
    expect(classifyChatError('live chat is no longer available')).toBe('ended')
    expect(classifyChatError('This channel is members-only')).toBe('members_only')
    expect(classifyChatError('Chat is disabled for this live stream.')).toBe('chat_disabled')
    expect(classifyChatError('boom', 429)).toBe('rate_limited')
    expect(classifyChatError('boom')).toBe('transient')
  })

  it('Netscape cookie jar 只保留 youtube / google 域', () => {
    const dir = mkdtempSync(join(tmpdir(), 'live-chat-cookie-'))
    const path = join(dir, 'cookies.txt')
    writeFileSync(path, [
      '# Netscape HTTP Cookie File',
      '.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret',
      '.google.com\tTRUE\t/\tTRUE\t0\tSAPISID\tabc',
      '.example.com\tTRUE\t/\tTRUE\t0\tOTHER\tnope',
    ].join('\n'), 'utf8')
    expect(netscapeCookieHeader(path)).toBe('SID=secret; SAPISID=abc')
    // 手工请求 watch 页只发 youtube.com，避免 google.com cookie 触发降级页。
    expect(netscapeCookieHeader(path, { domains: ['youtube.com'] })).toBe('SID=secret')
    rmSync(dir, { recursive: true, force: true })
  })
})
