import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectReplay } from './live-chat-collect.ts'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'live-chat-collect-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

function watchHtml(isReplay: boolean): string {
  const data = {
    contents: {
      liveChatRenderer: {
        isReplay,
        continuations: [{
          reloadContinuationData: { continuation: isReplay ? 'RELOAD' : 'LIVE' },
        }],
      },
    },
  }
  const player = {
    playabilityStatus: { status: 'OK' },
    videoDetails: { title: '标题', channelId: 'UC1', author: '频道', lengthSeconds: '600' },
    microformat: { playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow: false } } },
  }
  return `<html><script>var ytInitialData = ${JSON.stringify(data)};</script><script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script></html>`
}

function textItem(id: string, ts: number, text: string, author = '@viewer') {
  return {
    addChatItemAction: {
      item: {
        liveChatTextMessageRenderer: {
          id,
          timestampUsec: String(ts * 1_000_000),
          authorName: { simpleText: author },
          authorExternalChannelId: 'UCVIEWER',
          message: {
            runs: text === '' ? [] : [{ text }],
          },
        },
      },
    },
  }
}

function emojiItem(id: string, ts: number) {
  return {
    addChatItemAction: {
      item: {
        liveChatTextMessageRenderer: {
          id,
          timestampUsec: String(ts * 1_000_000),
          authorName: { simpleText: '@emoji' },
          authorExternalChannelId: 'UCVIEWER',
          message: {
            runs: [{
              emoji: {
                emojiId: 'UCCH/abc',
                isCustomEmoji: true,
                shortcuts: [':_hooray:'],
                image: {
                  thumbnails: [{ url: 'https://example/48.png', width: 48 }],
                  accessibility: { accessibilityData: { label: 'hooray' } },
                },
              },
            }],
          },
        },
      },
    },
  }
}

function replayPayload(items: unknown[], next?: string, extraActions: unknown[] = []) {
  return {
    continuationContents: {
      liveChatContinuation: {
        actions: [...extraActions, { replayChatItemAction: { actions: items } }],
        continuations: next
          ? [{ liveChatReplayContinuationData: { continuation: next, timeUntilLastMessageMsec: 5000 } }]
          : [],
      },
    },
  }
}

function stubFetch(pages: Record<string, unknown>, watch = watchHtml(true)): void {
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/watch?'))
      return new Response(watch, { status: 200 })
    const body = JSON.parse(String(init?.body ?? '{}')) as { continuation?: string }
    const payload = pages[body.continuation ?? '']
    if (!payload)
      return new Response(JSON.stringify({ error: { code: 400 } }), { status: 400 })
    return new Response(JSON.stringify(payload), { status: 200 })
  })
}

describe('collectReplay', () => {
  it('翻完回放：写消息 / 事件 / 表情，续页去重并合并实时采集', async () => {
    const session = tempDir()
    const danmakuDir = join(session, 'danmaku')
    mkdirSync(danmakuDir, { recursive: true })
    // 实时采集已经抓到开播前一条，合并后应该排在回放消息之前。
    writeFileSync(join(danmakuDir, 'danmaku_live_VID1234567.jsonl'), `${JSON.stringify({
      seq: 1,
      ts: 99,
      rendererId: 'LIVE1',
      msg: { author: '@live', kind: 'text', text: 'pre' },
    })}\n`, 'utf8')

    stubFetch({
      RELOAD: replayPayload([
        textItem('M1', 100, 'hello'),
        emojiItem('M2', 101),
      ], 'P2'),
      P2: replayPayload([
        textItem('M1', 100, 'hello'),
        textItem('M3', 102, 'bye'),
      ], undefined, [
        { markChatItemAsDeletedAction: { targetItemId: 'M1' } },
      ]),
    })

    const result = await collectReplay({ videoId: 'VID1234567', session, pageDelayMs: 0 })

    expect(result.status).toBe('done')
    expect(result.added).toBe(3)
    expect(result.total).toBe(4)
    expect(result.events).toBe(1)
    expect(result.emojis).toBe(1)

    const rows = readFileSync(join(danmakuDir, 'danmaku_VID1234567.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map(line => JSON.parse(line))
    expect(rows.map(row => row.msg.text)).toEqual(['pre', 'hello', '', 'bye'])
    expect(rows.map(row => row.seq)).toEqual([1, 2, 3, 4])
    expect(rows[2].msg.emoji).toEqual([{ id: 'UCCH/abc' }])

    const emoji = JSON.parse(readFileSync(join(danmakuDir, 'emoji_VID1234567.json'), 'utf8'))
    expect(emoji.emojis[0]).toMatchObject({ id: 'UCCH/abc', name: 'hooray' })

    const events = readFileSync(join(danmakuDir, 'events_VID1234567.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map(line => JSON.parse(line))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'deleted', data: { targetItemId: 'M1' } })

    const state = JSON.parse(readFileSync(join(session, 'work', 'replay-state.json'), 'utf8'))
    expect(state.stopReason).toBe('done')
    expect(state.continuation).toBeNull()
  })

  it('直播中不写文件，返回 live', async () => {
    const session = tempDir()
    stubFetch({}, watchHtml(false))
    const result = await collectReplay({ videoId: 'LIVE1234567', session, pageDelayMs: 0 })
    expect(result.status).toBe('live')
    expect(existsSync(join(session, 'danmaku'))).toBe(false)
  })

  it('从 replay-state 续翻，不重复已有消息', async () => {
    const session = tempDir()
    const danmakuDir = join(session, 'danmaku')
    mkdirSync(join(session, 'work'), { recursive: true })
    mkdirSync(danmakuDir, { recursive: true })
    writeFileSync(join(danmakuDir, 'danmaku_VID1234567.jsonl'), `${JSON.stringify({
      seq: 1,
      ts: 100,
      rendererId: 'M1',
      msg: { author: '@viewer', kind: 'text', text: 'hello', timestampUs: '100000000' },
    })}\n`, 'utf8')
    writeFileSync(join(session, 'work', 'replay-state.json'), JSON.stringify({
      version: 1,
      videoId: 'VID1234567',
      session,
      continuation: 'P2',
      pages: 1,
      lastSeq: 1,
      stored: 1,
      eventsStored: 0,
      duplicates: 0,
      lastTs: 100,
      updatedAt: new Date().toISOString(),
      stopReason: null,
    }), 'utf8')

    const requests: string[] = []
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/watch?'))
        return new Response(watchHtml(true), { status: 200 })
      const body = JSON.parse(String(init?.body ?? '{}')) as { continuation?: string }
      requests.push(body.continuation ?? '')
      return new Response(JSON.stringify(replayPayload([
        textItem('M1', 100, 'hello'),
        textItem('M2', 101, 'again'),
      ])), { status: 200 })
    })

    const result = await collectReplay({ videoId: 'VID1234567', session, pageDelayMs: 0 })
    expect(requests).toEqual(['P2'])
    expect(result.total).toBe(2)
    expect(result.added).toBe(1)
    const rows = readFileSync(join(danmakuDir, 'danmaku_VID1234567.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map(line => JSON.parse(line))
    expect(rows.map(row => row.msg.text)).toEqual(['hello', 'again'])
  })
})
