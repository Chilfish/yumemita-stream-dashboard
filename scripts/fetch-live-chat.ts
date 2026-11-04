#!/usr/bin/env bun
/**
 * 开播前 / 直播中的弹幕采集（InnerTube live chat）。
 *
 *   bun run fetch:live-chat --video fmjJNbzcr3g
 *   bun run fetch:live-chat --dataset yuno --ids ids.txt --once
 *
 * yt-dlp 的 `live_chat` 字幕只在直播结束后才有，等待室与直播中的弹幕它拿不到。
 * 本脚本从 watch 页取 `liveChatRenderer` 的 continuation（等待室只有 reload），
 * 轮询 `youtubei/v1/live_chat/get_live_chat`，按与回放完全相同的口径归一化：
 * text / SC / 贴纸 / 会员 / 赠送会员 / 领取赠礼、徽章、authorId、频道表情、主播发言。
 *
 * 输出（与 `fetch-streams` / `fetch-danmaku` 共用会话目录）：
 *   danmaku/danmaku_live_<videoId>.jsonl   实时采集，记录带 `rendererId` 供合并去重
 *   danmaku/emoji_<videoId>.json           本场出现过的频道表情
 *   work/live-chat-state.json              continuation / 计数 / 停止原因，可续跑
 *
 * 与回放的合并由 `fetch-streams` / `fetch-danmaku` 在抓到回放后自动完成
 * （`scripts/lib/danmaku-merge.ts`，按 `rendererId` 去重）。
 *
 * 注意：默认跟随到直播结束（Ctrl-C 可随时停，状态会保存）。加 `--once` 只拉一页，
 * 适合定时任务或开播前先把等待室历史落盘。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { danmakuKey, loadDanmakuFile, writeDanmakuFile } from './lib/danmaku-merge.ts'
import { loadEnvFiles } from './lib/env.ts'
import {
  classifyChatError,
  classifyWatchStatus,
  extractChatItems,
  extractPollContinuation,
  extractWatchPage,
  hasApiError,
  LIVE_CHAT_API_URL,
  INNERTUBE_CONTEXT,
  netscapeCookieHeader,
  pollDelayMs,
  WATCH_URL,
  WEB_HEADERS,
  type WatchDisposition,
  type WatchPage,
  type WatchStatus,
} from './lib/innertube-live.ts'
import { writeEmojiSidecar, type ChatEmoji, type ChatRecord } from './lib/live-chat.ts'
import { chatEventKey, extractChatEvents, type ChatEventRecord } from './lib/live-chat-events.ts'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')
const STATE_VERSION = 1

interface DatasetSource {
  id: string
  label: string
  channelId?: string
}

interface CollectorState {
  version: number
  videoId: string
  datasetId: string | null
  label: string | null
  session: string
  startedAt: string
  updatedAt: string
  continuation: string | null
  continuationKind: string | null
  lastSeq: number
  stored: number
  eventsStored: number
  duplicates: number
  polls: number
  disposition: WatchDisposition
  status: WatchStatus | null
  lastError: string | null
  stopReason: string | null
}

const OPTIONS = {
  video: { type: 'string' },
  ids: { type: 'string' },
  dataset: { type: 'string' },
  root: { type: 'string' },
  cookie: { type: 'string' },
  cookies: { type: 'string' },
  'max-hours': { type: 'string', default: '0' },
  'min-interval': { type: 'string', default: '1000' },
  'max-interval': { type: 'string', default: '15000' },
  once: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const

const USAGE = `用法：bun scripts/fetch-live-chat.ts --video <id> [选项]

开播前 / 直播中通过 InnerTube 采集弹幕，写 danmaku_live_<videoId>.jsonl。
结束后由 fetch:streams / fetch:danmaku 抓回放并按消息 id 自动合并。

选项：
  --video <id>          单个视频 ID
  --ids <文件>          视频 ID 列表（每行一个）
  --dataset <id>        强制指定 dataset；默认按 watch 页的 channelId 匹配
  --root <目录>         会话根目录（默认 $STREAM_SESSION_ROOT 或 ./temp/youtube-live）
  --cookie <字符串>     Cookie 请求头（会员限定需要）；也可用环境变量 YT_COOKIE
  --cookies <文件>      Netscape cookie jar（yt-dlp 导出的 cookies.txt）
  --max-hours <n>       最长跟随小时数，0 = 不限（默认 0）
  --min-interval <ms>   轮询间隔下限，默认 1000
  --max-interval <ms>   轮询间隔上限，默认 15000
  --once                只取一页（等待室历史 / 定时任务），不进入跟随循环
  --dry-run             只打印统计，不写文件
  -h, --help            显示本帮助

停止条件：直播结束、聊天被禁用、播放器受限且没有弹幕 token、--max-hours 到点或 Ctrl-C。
等待室（LIVE_STREAM_OFFLINE）不是终态，会继续轮询。`

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

function jstDate(seconds: number | null): string {
  if (seconds == null)
    return '0000-00-00'
  return new Date((seconds + 540 * 60) * 1000).toISOString().slice(0, 10)
}

function videoIdOf(raw: string): string | null {
  const trimmed = raw.trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed))
    return trimmed
  const match = /(?:v=|youtu\.be\/|\/live\/)([A-Za-z0-9_-]{11})/.exec(trimmed)
  return match?.[1] ?? null
}

function buildHeaders(cookie: string | null): Record<string, string> {
  return cookie ? { ...WEB_HEADERS, Cookie: cookie } : { ...WEB_HEADERS }
}

class ChatHttpError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message)
  }
}

async function fetchWatchPage(videoId: string, headers: Record<string, string>): Promise<string> {
  const response = await fetch(WATCH_URL(videoId), { headers })
  if (!response.ok)
    throw new ChatHttpError(`watch_page_http_${response.status}`, response.status, '')
  return await response.text()
}

async function pollChat(continuation: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(LIVE_CHAT_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ context: INNERTUBE_CONTEXT, continuation }),
  })
  const body = await response.text()
  if (!response.ok)
    throw new ChatHttpError(`live_chat_http_${response.status}`, response.status, body)
  try {
    return JSON.parse(body) as unknown
  }
  catch (error) {
    throw new Error(`live_chat_bad_json: ${describe(error)}`)
  }
}

function saveState(path: string, state: CollectorState): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
}

function loadState(path: string, videoId: string): CollectorState | null {
  if (!existsSync(path))
    return null
  try {
    const state = readJson<CollectorState>(path)
    return state.videoId === videoId ? state : null
  }
  catch {
    return null
  }
}

function existingSession(root: string, videoId: string): string | null {
  if (!existsSync(root))
    return null
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.'))
      continue
    if (entry.name.endsWith(`_${videoId}`))
      return join(root, entry.name)
  }
  return null
}

function readEmojiSidecar(path: string): Map<string, ChatEmoji> {
  const emojis = new Map<string, ChatEmoji>()
  if (!existsSync(path))
    return emojis
  try {
    const payload = readJson<{ emojis?: ChatEmoji[] }>(path)
    for (const emoji of payload.emojis ?? []) {
      if (emoji?.id && emoji.url)
        emojis.set(emoji.id, emoji)
    }
  }
  catch {
    // 坏档就重新生成
  }
  return emojis
}

interface ResolvedDataset {
  dataset: DatasetSource | null
  label: string
}

function resolveDataset(
  sources: DatasetSource[],
  channelId: string | null,
  explicitId: string | undefined,
): ResolvedDataset {
  if (explicitId) {
    const dataset = sources.find(source => source.id === explicitId) ?? null
    return { dataset, label: dataset?.label ?? explicitId }
  }
  const dataset = channelId
    ? sources.find(source => source.channelId === channelId) ?? null
    : null
  return { dataset, label: dataset?.label ?? 'unknown' }
}

interface CollectOptions {
  root: string
  cookie: string | null
  minInterval: number
  maxInterval: number
  once: boolean
  dryRun: boolean
  maxHours: number
  datasetId: string | undefined
}

function log(line: string): void {
  console.log(`[live-chat] ${line}`)
}

async function collectVideo(videoId: string, options: CollectOptions, sources: DatasetSource[]): Promise<void> {
  const headers = buildHeaders(options.cookie)

  let watch: WatchPage | null = null
  let watchError: string | null = null
  try {
    watch = extractWatchPage(await fetchWatchPage(videoId, headers))
  }
  catch (error) {
    watchError = describe(error)
  }

  const resolved = resolveDataset(sources, watch?.channelId ?? null, options.datasetId)
  if (options.datasetId && !resolved.dataset) {
    console.error(`[live-chat] data-sources.json 里没有 dataset：${options.datasetId}`)
    process.exitCode = 1
    return
  }

  const date = jstDate(watch?.scheduledStart ?? null)
  const session = existingSession(options.root, videoId)
    ?? join(options.root, `${date}_${resolved.label}_${videoId}`)
  const danmakuDir = join(session, 'danmaku')
  const livePath = join(danmakuDir, `danmaku_live_${videoId}.jsonl`)
  const eventsPath = join(danmakuDir, `events_${videoId}.jsonl`)
  const emojiPath = join(danmakuDir, `emoji_${videoId}.json`)
  const statePath = join(session, 'work', 'live-chat-state.json')
  const prior = loadState(statePath, videoId)

  if (!options.dryRun) {
    mkdirSync(danmakuDir, { recursive: true })
    mkdirSync(join(session, 'work'), { recursive: true })
  }

  const loaded = loadDanmakuFile(livePath)
  const seen = new Set(loaded.records.map(record => danmakuKey(record)))
  let seq = loaded.records.reduce(
    (max, record) => Math.max(max, typeof record.seq === 'number' ? record.seq : 0),
    0,
  )
  const loadedEvents = loadDanmakuFile(eventsPath)
  const seenEvents = new Set(loadedEvents.records.map(record => chatEventKey(record as unknown as ChatEventRecord)))
  let eventSeq = loadedEvents.records.reduce(
    (max, record) => Math.max(max, typeof record.seq === 'number' ? record.seq : 0),
    0,
  )
  let duplicates = prior?.duplicates ?? 0
  // rendererId → 作者/是否主播：删除事件要能对回被删消息，主播消息被删时仍能识别。
  const recordIndex = new Map<string, { author?: string, authorId?: string, owner: boolean, kind?: string, text?: string }>()
  const authorIndex = new Map<string, { name?: string, owner: boolean }>()
  const indexRecord = (record: ChatRecord): void => {
    if (record.rendererId) {
      recordIndex.set(record.rendererId, {
        author: record.msg.author,
        authorId: record.msg.authorId,
        owner: (record.msg.badges ?? []).includes('Owner'),
        kind: record.msg.kind,
        text: record.msg.text,
      })
    }
    if (record.msg.authorId) {
      const known = authorIndex.get(record.msg.authorId)
      authorIndex.set(record.msg.authorId, {
        name: record.msg.author ?? known?.name,
        owner: known?.owner === true || (record.msg.badges ?? []).includes('Owner'),
      })
    }
  }
  for (const record of loaded.records)
    indexRecord(record as unknown as ChatRecord)

  /** 删除事件对回被删消息：补作者、kind 与是否主播；被删正文留在 data 里。 */
  const decorateEvent = (event: ChatEventRecord): void => {
    if (event.type === 'deleted' && event.data?.targetItemId) {
      const target = recordIndex.get(String(event.data.targetItemId))
      if (!target)
        return
      event.author = target.author
      event.authorId = target.authorId
      event.owner = target.owner
      event.data = {
        ...event.data,
        targetAuthor: target.author ?? null,
        targetAuthorId: target.authorId ?? null,
        targetKind: target.kind ?? null,
        targetText: target.text ?? null,
        targetOwner: target.owner,
      }
      return
    }
    if (event.type === 'deletedAuthor' && event.data?.authorId) {
      const author = authorIndex.get(String(event.data.authorId))
      if (!author)
        return
      event.author = author.name
      event.owner = author.owner
      event.data = { ...event.data, targetAuthor: author.name ?? null, targetOwner: author.owner }
    }
  }
  if (loaded.invalid > 0 && !options.dryRun) {
    writeDanmakuFile(livePath, loaded.records)
    log(`${videoId} 清理 ${loaded.invalid} 行损坏记录`)
  }
  if (loadedEvents.invalid > 0 && !options.dryRun) {
    writeDanmakuFile(eventsPath, loadedEvents.records)
    log(`${videoId} 清理 ${loadedEvents.invalid} 行损坏事件`)
  }
  const emojis = readEmojiSidecar(emojiPath)

  let status = watch?.status ?? prior?.status ?? null
  let disposition: WatchDisposition = status ? classifyWatchStatus(status) : 'pending'
  let continuation = watch?.continuation?.token ?? (watchError ? prior?.continuation ?? null : null)
  let continuationKind = watch?.continuation?.kind ?? null
  let lastError: string | null = watchError

  const state: CollectorState = {
    version: STATE_VERSION,
    videoId,
    datasetId: resolved.dataset?.id ?? null,
    label: resolved.label,
    session,
    startedAt: prior?.startedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    continuation,
    continuationKind,
    lastSeq: seq,
    stored: seen.size,
    eventsStored: seenEvents.size,
    duplicates,
    polls: prior?.polls ?? 0,
    disposition,
    status,
    lastError,
    stopReason: null,
  }
  const persist = (): void => {
    state.updatedAt = new Date().toISOString()
    state.continuation = continuation
    state.continuationKind = continuationKind
    state.lastSeq = seq
    state.stored = seen.size
    state.eventsStored = seenEvents.size
    state.duplicates = duplicates
    state.disposition = disposition
    state.status = status
    state.lastError = lastError
    if (!options.dryRun)
      saveState(statePath, state)
  }

  log(`${videoId} ${resolved.label} 会话 ${session.split(/[\\/]/).at(-1)}`)
  if (watch?.title)
    log(`${videoId} 标题：${watch.title}`)
  if (status) {
    log(`${videoId} 状态：${disposition}${status.isReplay ? '（已是回放）' : ''}${status.availability === 'subscriber_only' ? '（会员限定）' : ''}`)
  }

  if (disposition === 'ended') {
    log(`${videoId} 直播已结束，实时采集跳过；回放由 fetch:streams / fetch:danmaku 处理`)
    state.stopReason = 'ended'
    persist()
    return
  }
  if (disposition === 'chat_disabled') {
    log(`${videoId} 聊天已被禁用，无法采集`)
    state.stopReason = 'chat_disabled'
    persist()
    return
  }
  if (disposition === 'unplayable' && !continuation) {
    log(`${videoId} 播放器受限且没有弹幕 token（会员限定 / 需要登录 cookie）`)
    state.stopReason = 'unplayable'
    persist()
    return
  }
  if (!continuation && watchError) {
    log(`${videoId} 取不到 continuation：${watchError}`)
    state.stopReason = 'no_continuation'
    persist()
    return
  }

  let running = true
  const onSignal = (): void => {
    running = false
    log(`${videoId} 收到中断，保存状态后退出`)
  }
  process.once('SIGINT', onSignal)

  let stopReason: string | null = null
  let backoff = 2000
  const startedMs = Date.now()
  let lastStatusCheck = Date.now()

  while (running) {
    if (options.maxHours > 0 && Date.now() - startedMs >= options.maxHours * 3600_000) {
      stopReason = 'max_hours'
      break
    }

    // 等待室的 timed 链在直播结束后仍可能继续给空页；定期重看 watch 页确认终态。
    if (Date.now() - lastStatusCheck >= 10 * 60_000) {
      lastStatusCheck = Date.now()
      try {
        const page = extractWatchPage(await fetchWatchPage(videoId, headers))
        status = page.status
        const nextDisposition = classifyWatchStatus(status)
        if (nextDisposition !== disposition)
          log(`${videoId} 状态变化：${disposition} → ${nextDisposition}`)
        disposition = nextDisposition
        if (disposition === 'ended' || disposition === 'chat_disabled') {
          stopReason = disposition
          persist()
          break
        }
      }
      catch (error) {
        lastError = describe(error)
        log(`${videoId} 定期检查 watch 页失败：${lastError}`)
      }
      persist()
    }

    if (!continuation) {
      if (disposition === 'ended' || disposition === 'chat_disabled') {
        stopReason = disposition
        break
      }
      await sleep(Math.min(backoff, 60_000))
      if (!running)
        break
      backoff = Math.min(backoff * 2, 60_000)
      try {
        watch = extractWatchPage(await fetchWatchPage(videoId, headers))
        status = watch.status
        disposition = classifyWatchStatus(status)
        continuation = watch.continuation?.token ?? null
        continuationKind = watch.continuation?.kind ?? null
        lastError = null
        log(`${videoId} 重新取 token：${disposition} ${continuation ? `(${continuationKind})` : '（无）'}`)
        if (!continuation && (disposition === 'ended' || disposition === 'chat_disabled' || disposition === 'unplayable')) {
          stopReason = disposition
          break
        }
      }
      catch (error) {
        lastError = describe(error)
        log(`${videoId} watch 页失败：${lastError}`)
      }
      persist()
      continue
    }

    let payload: unknown
    try {
      payload = await pollChat(continuation, headers)
      backoff = 2000
    }
    catch (error) {
      const message = describe(error)
      const httpStatus = error instanceof ChatHttpError ? error.status : undefined
      const body = error instanceof ChatHttpError ? error.body : ''
      const kind = classifyChatError(`${message} ${body}`, httpStatus)
      lastError = message
      log(`${videoId} 轮询失败（${kind}）：${message}`)
      if (kind === 'members_only' || kind === 'chat_disabled' || kind === 'ended') {
        stopReason = kind
        break
      }
      continuation = null
      continuationKind = null
      await sleep(Math.min(backoff, 60_000))
      backoff = Math.min(backoff * 2, 60_000)
      persist()
      continue
    }

    if (hasApiError(payload)) {
      const message = JSON.stringify(payload)
      const kind = classifyChatError(message)
      lastError = message
      log(`${videoId} 上游错误（${kind}）：${message.slice(0, 200)}`)
      if (kind === 'members_only' || kind === 'chat_disabled' || kind === 'ended') {
        stopReason = kind
        break
      }
      continuation = null
      continuationKind = null
      await sleep(Math.min(backoff, 60_000))
      backoff = Math.min(backoff * 2, 60_000)
      persist()
      continue
    }

    const messageResult = extractChatItems(payload, videoId, emojis)
    const eventResult = extractChatEvents(payload, videoId, {
      now: Math.round(Date.now() / 1000),
      emojis,
    })
    const records = [...eventResult.messages, ...messageResult.records]
    const skipped = { ...messageResult.skipped, ...eventResult.skipped }
    const lines: string[] = []
    let added = 0
    let duplicatesThisPoll = 0
    for (const record of records) {
      const key = danmakuKey(record)
      if (seen.has(key)) {
        duplicatesThisPoll += 1
        continue
      }
      seen.add(key)
      record.seq = ++seq
      indexRecord(record)
      lines.push(JSON.stringify(record))
      added += 1
    }
    duplicates += duplicatesThisPoll

    const eventLines: string[] = []
    let eventsAdded = 0
    for (const event of eventResult.events) {
      const key = chatEventKey(event)
      if (seenEvents.has(key))
        continue
      seenEvents.add(key)
      decorateEvent(event)
      event.seq = ++eventSeq
      eventLines.push(JSON.stringify(event))
      eventsAdded += 1
    }

    if (!options.dryRun && (lines.length > 0 || eventLines.length > 0)) {
      if (lines.length > 0)
        appendFileSync(livePath, `${lines.join('\n')}\n`, 'utf8')
      if (eventLines.length > 0)
        appendFileSync(eventsPath, `${eventLines.join('\n')}\n`, 'utf8')
      if (emojis.size > 0)
        writeEmojiSidecar(livePath, videoId, emojis)
    }

    state.polls += 1
    lastError = null
    const skippedDetail = Object.entries(skipped)
      .map(([kind, count]) => `${kind.replace(/^liveChat|Renderer$/g, '')} ${count}`)
      .join(' / ')
    log(`${videoId} ${disposition} +${added}（重复 ${duplicatesThisPoll} / 合计 ${seen.size} / 事件 +${eventsAdded}（合计 ${seenEvents.size}） / 轮询 ${state.polls}）${skippedDetail ? ` 跳过 ${skippedDetail}` : ''}`)
    persist()

    if (options.once) {
      stopReason = 'once'
      break
    }

    const next = extractPollContinuation(payload)
    if (!next) {
      continuation = null
      continuationKind = null
      await sleep(3000)
      continue
    }
    continuation = next.token
    continuationKind = next.kind
    await sleep(pollDelayMs(payload, { minMs: options.minInterval, maxMs: options.maxInterval }))
  }

  process.removeListener('SIGINT', onSignal)
  state.stopReason = stopReason ?? (running ? 'done' : 'interrupted')
  persist()
  log(`${videoId} 结束（${state.stopReason}）：合计 ${seen.size} 条，事件 ${seenEvents.size} 条，重复 ${duplicates}，轮询 ${state.polls}；${options.dryRun ? 'dry-run 未写入' : `输出 ${livePath}`}`)
}

async function main(): Promise<void> {
  loadEnvFiles()
  const { values } = parseArgs({ options: OPTIONS, args: process.argv.slice(2), allowPositionals: false })
  if (values.help) {
    console.log(USAGE)
    return
  }

  const rawIds: string[] = []
  if (values.video)
    rawIds.push(values.video)
  if (values.ids) {
    const path = resolve(values.ids)
    if (!existsSync(path)) {
      console.error(`[live-chat] 找不到 ID 列表：${path}`)
      process.exit(1)
    }
    rawIds.push(...readFileSync(path, 'utf8').split(/\r?\n/))
  }
  const ids = [...new Set(rawIds.map(videoIdOf).filter((id): id is string => id !== null))]
  if (ids.length === 0) {
    console.error('[live-chat] 请用 --video <id> 或 --ids <文件> 指定视频')
    console.error(USAGE)
    process.exit(1)
  }

  const sources = existsSync(CONFIG_PATH)
    ? readJson<{ datasets?: DatasetSource[] }>(CONFIG_PATH).datasets ?? []
    : []

  const root = resolve(values.root ?? process.env.STREAM_SESSION_ROOT ?? join(APP_ROOT, 'temp', 'youtube-live'))
  const dataRoot = join(APP_ROOT, 'data')
  if (root === dataRoot || root.startsWith(`${dataRoot}${sep}`)) {
    console.error('[live-chat] --root 是原始素材目录，不能指向 data/')
    process.exit(1)
  }
  if (!values['dry-run']) {
    mkdirSync(root, { recursive: true })
    if ((root.startsWith(`${APP_ROOT}/`) || root.startsWith(`${APP_ROOT}\\`)) && !existsSync(join(root, '.gitignore')))
      writeFileSync(join(root, '.gitignore'), '*\n', 'utf8')
  }

  const cookie = values.cookie
    ?? (values.cookies ? netscapeCookieHeader(resolve(values.cookies)) : null)
    ?? process.env.YT_COOKIE
    ?? null

  const options: CollectOptions = {
    root,
    cookie,
    minInterval: Math.max(1000, Number(values['min-interval']) || 1000),
    maxInterval: Math.max(1000, Number(values['max-interval']) || 15_000),
    once: Boolean(values.once),
    dryRun: Boolean(values['dry-run']),
    maxHours: Math.max(0, Number(values['max-hours']) || 0),
    datasetId: values.dataset,
  }
  if (options.maxInterval < options.minInterval) {
    console.error('[live-chat] --max-interval 不能小于 --min-interval')
    process.exit(1)
  }
  if (!cookie)
    log('未提供 cookie：公开场次可采集；会员限定场次会停在 unplayable')

  // 多视频时 Ctrl-C 一次就整体停下，不要继续下一个场次。
  let interrupted = false
  process.once('SIGINT', () => {
    interrupted = true
  })

  for (const videoId of ids) {
    if (interrupted)
      break
    try {
      await collectVideo(videoId, options, sources)
    }
    catch (error) {
      console.error(`[live-chat] ${videoId} 失败：${describe(error)}`)
      process.exitCode = 1
    }
  }
}

await main()
