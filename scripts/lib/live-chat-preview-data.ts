/**
 * 开发预览的 Node 侧数据加载：只在 `astro dev` 的 Vite 中间件里调用。
 * 不进入客户端 bundle，也不在生产环境执行。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { buildPreviewSession, type PreviewData, type PreviewSessionMeta } from '../../src/lib/live-chat-preview.ts'

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  }
  catch {
    return null
  }
}

/**
 * dataset 表情索引：优先本地 `data/<id>/emoji/index.json`，没有就请求对象存储。
 * 浏览器直接 fetch 对象存储的 JSON 可能被 CORS 挡住，所以预览走同源中间件。
 */
export async function loadEmojiIndex(
  root: string,
  datasetId: string,
  baseUrl: string,
): Promise<Record<string, string>> {
  if (!datasetId)
    return {}
  const projectRoot = resolve(root, '..', '..')
  const local = join(projectRoot, 'data', datasetId, 'emoji', 'index.json')
  const localPayload = await readJson<{ names?: Record<string, string> }>(local)
  if (localPayload?.names)
    return localPayload.names

  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/emojis/${encodeURIComponent(datasetId)}/index.json`)
  if (!response.ok)
    return {}
  const payload = await response.json() as { names?: Record<string, string> }
  return payload.names ?? {}
}

export async function loadPreviewData(root: string, sessionId?: string | null): Promise<PreviewData> {
  const data: PreviewData = { root, sessions: [], session: null, error: null }

  try {
    const entries = await readdir(root, { withFileTypes: true })
    const discovered: { meta: PreviewSessionMeta, mtime: number }[] = []

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.'))
        continue
      const dir = join(root, entry.name)
      const danmakuDir = join(dir, 'danmaku')
      const files = await readdir(danmakuDir).catch(() => [] as string[])

      const messages = files.find(name => /^danmaku_[A-Za-z0-9_-]{11}\.jsonl$/.test(name))
        ?? files.find(name => /^danmaku_live_[A-Za-z0-9_-]{11}\.jsonl$/.test(name))
        ?? null
      const events = files.find(name => /^events_[A-Za-z0-9_-]{11}\.jsonl$/.test(name)) ?? null
      if (!messages && !events)
        continue

      const state = await readJson<Record<string, unknown>>(join(dir, 'work', 'live-chat-state.json'))
      const info = await readJson<Record<string, unknown>>(join(dir, 'meta', 'info.json'))
      const status = state?.status && typeof state.status === 'object'
        ? state.status as Record<string, unknown>
        : null
      const match = /_([A-Za-z0-9_-]{11})\.jsonl$/.exec(messages ?? events ?? '')
      const videoId = typeof state?.videoId === 'string'
        ? state.videoId
        : typeof info?.id === 'string'
          ? info.id
          : match?.[1] ?? entry.name.slice(-11)
      const release = typeof info?.release_timestamp === 'number' ? info.release_timestamp : null
      const startedAt = typeof status?.startTimestamp === 'string'
        ? status.startTimestamp
        : release != null
          ? new Date(release * 1000).toISOString()
          : null
      const fileStat = await stat(dir).catch(() => null)

      discovered.push({
        meta: {
          id: entry.name,
          videoId,
          datasetId: typeof state?.datasetId === 'string' ? state.datasetId : null,
          label: typeof state?.label === 'string' ? state.label : null,
          title: typeof info?.title === 'string' ? info.title : null,
          startedAt,
          dir,
          updatedAt: typeof state?.updatedAt === 'string'
            ? state.updatedAt
            : fileStat?.mtime.toISOString() ?? null,
          files: {
            messages,
            events,
            emoji: files.find(name => /^emoji_[A-Za-z0-9_-]{11}\.json$/.test(name)) ?? null,
            state: state ? join(dir, 'work', 'live-chat-state.json') : null,
            meta: info ? join(dir, 'meta', 'info.json') : null,
          },
          status,
        },
        mtime: fileStat?.mtimeMs ?? 0,
      })
    }

    discovered.sort((a, b) => {
      const left = a.meta.updatedAt ? Date.parse(a.meta.updatedAt) : a.mtime
      const right = b.meta.updatedAt ? Date.parse(b.meta.updatedAt) : b.mtime
      return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0)
    })

    data.sessions = discovered.slice(0, 50).map(item => item.meta)
    const selected = data.sessions.find(item => item.id === sessionId) ?? data.sessions[0] ?? null

    if (selected) {
      const [messagesText, eventsText, emojiText] = await Promise.all([
        selected.files.messages
          ? readFile(join(selected.dir, 'danmaku', selected.files.messages), 'utf8').catch(() => '')
          : Promise.resolve(''),
        selected.files.events
          ? readFile(join(selected.dir, 'danmaku', selected.files.events), 'utf8').catch(() => '')
          : Promise.resolve(''),
        selected.files.emoji
          ? readFile(join(selected.dir, 'danmaku', selected.files.emoji), 'utf8').catch(() => null)
          : Promise.resolve(null),
      ])
      data.session = buildPreviewSession({
        meta: selected,
        messagesText,
        eventsText,
        emojiText,
      })
    }
  }
  catch (error) {
    data.error = error instanceof Error ? error.message : String(error)
  }

  return data
}
