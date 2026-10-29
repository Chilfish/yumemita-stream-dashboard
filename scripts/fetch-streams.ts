#!/usr/bin/env bun
/**
 * 批量补齐某个 dataset 的历史直播：元信息、弹幕回放、评论、VSTATS，并增量生成 datapack。
 *
 *   bun scripts/fetch-streams.ts --dataset nonoka --root "D:/path/to/temp/youtube-live"
 *
 * 特性：
 *   - 可重入：已存在的 meta / danmaku jsonl / comments 不重抓，按 videoId 跳过已入库场次
 *   - 并发：元信息与媒体分别限流，默认 6 / 3
 *   - 增量落库：每 N 场调用一次 stream-datapack.ts，manifest 始终是当前进度
 *   - 可观测：进度写 `<state-dir>/fetch-progress.json`，日志追加 `<state-dir>/fetch.log`
 *   - 去重：同名场次保留时长正常的一条（短摘要/预告让位正片）
 */
import { spawn } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { normalizeLiveChat } from './lib/live-chat.ts'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATASOURCES_PATH = join(APP_ROOT, 'data-sources.json')
const DATAPACK_SCRIPT = join(APP_ROOT, 'scripts', 'stream-datapack.ts')

interface DatasetSource {
  id: string
  label: string
  channelId?: string
  manifest: string
  datapackDir: string
}

interface InfoJson {
  id: string
  title?: string
  release_timestamp?: number
  timestamp?: number
  duration?: number
  availability?: string
  channel_id?: string
  live_status?: string
}

interface StreamSummary {
  videoId: string
  title: string
  durationSec: number | null
}

interface Candidate {
  id: string
  info?: InfoJson
  session?: string
  title?: string
  durationSec?: number | null
  reason?: string
}

interface Failure {
  id: string
  step: string
  error: string
}

const OPTIONS = {
  dataset: { type: 'string' },
  root: { type: 'string' },
  'state-dir': { type: 'string' },
  concurrency: { type: 'string', default: '3' },
  'meta-concurrency': { type: 'string', default: '6' },
  'build-every': { type: 'string', default: '5' },
  limit: { type: 'string', default: '0' },
  cookies: { type: 'string' },
  'cookies-from-browser': { type: 'string', default: 'firefox' },
  'dry-run': { type: 'boolean' },
  'no-build': { type: 'boolean' },
  ids: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const

const USAGE = `用法：bun scripts/fetch-streams.ts --dataset <id> --root <会话根目录> [选项]

按频道 /streams 列表补齐历史直播：yt-dlp 元信息 + live_chat 回放 + 评论 + VSTATS，
每 N 场生成 datapack 并 upsert manifest。已处理的场次会自动跳过。

选项：
  --dataset <id>             data-sources.json 里的 dataset；只有一个时可以省略
  --root <目录>              原始会话根目录（默认 $STREAM_SESSION_ROOT 或 ./temp/youtube-live）
  --state-dir <目录>         进度/日志/频道缓存（默认 <root>/.fetch-state）
  --concurrency <n>          媒体并发，默认 3
  --meta-concurrency <n>     元信息并发，默认 6
  --build-every <n>          每 n 场构建一次，默认 5；0 = 全部抓完再构建
  --limit <n>                本次最多处理 n 场（含元信息阶段），0 = 全部
  --cookies <文件>           Netscape cookie jar；不传则用 --cookies-from-browser
  --cookies-from-browser <b> 默认 firefox
  --dry-run                  只列出候选，不抓取
  --no-build                 只抓素材，不生成 datapack
  --ids <文件>               直接读视频 ID 列表（每行一个），跳过频道列表抓取
  -h, --help                 显示本帮助`

function logFile(path: string, message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`
  console.log(line)
  appendFileSync(path, `${line}\n`, 'utf8')
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function jstDate(seconds: number | undefined): string {
  if (!seconds)
    return '0000-00-00'
  return new Date((seconds + 540 * 60) * 1000).toISOString().slice(0, 10)
}

function run(command: string, args: string[], capture: boolean, retries = 2): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const attempt = (n: number): void => {
      const child = spawn(command, args, { stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'] })
      const out: Buffer[] = []
      const err: Buffer[] = []
      child.stdout?.on('data', chunk => out.push(chunk as Buffer))
      child.stderr?.on('data', chunk => err.push(chunk as Buffer))
      child.on('error', rejectPromise)
      child.on('close', (code) => {
        if (code === 0) {
          resolvePromise(Buffer.concat(out).toString('utf8'))
          return
        }
        const stderr = Buffer.concat(err).toString('utf8').trim()
        // 未来场/首播未开始：重试没有意义，直接返回给调用方按「跳过」处理。
        if (/will begin in|Premieres in|premieres in/i.test(stderr)) {
          rejectPromise(new Error(`${command} exit ${code}: ${stderr.split('\n').slice(-4).join(' | ')}`))
          return
        }
        if (n < retries) {
          setTimeout(() => attempt(n + 1), 5000 * (n + 1))
          return
        }
        rejectPromise(new Error(`${command} exit ${code}: ${stderr.split('\n').slice(-4).join(' | ')}`))
      })
    }
    attempt(0)
  })
}

async function pool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index] as T, index)
    }
  })
  await Promise.all(runners)
}

function isValidInfoJson(path: string, videoId: string): boolean {
  try {
    const info = readJson<InfoJson>(path)
    return info.id === videoId
  }
  catch {
    return false
  }
}

function main(): void {
  const { values } = parseArgs({ options: OPTIONS, args: process.argv.slice(2), allowPositionals: true })
  if (values.help) {
    console.log(USAGE)
    process.exit(0)
  }

  const sources = readJson<{ datasets?: DatasetSource[] }>(DATASOURCES_PATH).datasets ?? []
  const dataset = values.dataset
    ? sources.find(item => item.id === values.dataset)
    : sources.length === 1
      ? sources[0]
      : undefined
  if (!dataset) {
    console.error(`找不到 dataset：${values.dataset ?? '(请用 --dataset 指定)'}`)
    console.error(`可用：${sources.map(item => item.id).join(', ') || '(data-sources.json 为空)'}`)
    process.exit(1)
  }
  if (!dataset.channelId) {
    console.error(`dataset ${dataset.id} 缺少 channelId`)
    process.exit(1)
  }

  const manifestPath = resolve(APP_ROOT, dataset.manifest)
  if (!existsSync(manifestPath))
    console.warn(`[fetch-streams] 还没有 manifest（${dataset.manifest}），按空索引开始`)

  const root = resolve(values.root ?? process.env.STREAM_SESSION_ROOT ?? join(APP_ROOT, 'temp', 'youtube-live'))
  const dataRoot = join(APP_ROOT, 'data')
  if (root === dataRoot || root.startsWith(`${dataRoot}${sep}`)) {
    console.error('--root 是原始素材目录，不能指向 data/（datapack 输出目录）。')
    console.error('用归档工程的会话根目录，例如 --root "D:/projects/claude-messages/temp/youtube-live"；')
    console.error('或使用默认的 ./temp/youtube-live（已自动忽略，不会提交）。')
    process.exit(1)
  }
  const stateDir = resolve(values['state-dir'] ?? join(root, '.fetch-state'))
  mkdirSync(root, { recursive: true })
  mkdirSync(stateDir, { recursive: true })
  // 默认 root 在仓库内时，避免原始素材/状态被 git 看到。
  if (root.startsWith(`${APP_ROOT}/`) || root.startsWith(`${APP_ROOT}\\`)) {
    const ignorePath = join(root, '.gitignore')
    if (!existsSync(ignorePath))
      writeFileSync(ignorePath, '*\n', 'utf8')
  }
  const logPath = join(stateDir, 'fetch.log')
  const progressPath = join(stateDir, 'fetch-progress.json')
  const channelCache = join(stateDir, 'channel-ids.txt')

  const limit = Number(values.limit)
  const concurrency = Number(values.concurrency)
  const metaConcurrency = Number(values['meta-concurrency'])
  const buildEvery = Number(values['build-every'])
  const cookieArgs = values.cookies
    ? ['--cookies', resolve(values.cookies)]
    : ['--cookies-from-browser', values['cookies-from-browser'] ?? 'firefox']
  const ytdlpBase = ['--no-warnings', '--socket-timeout', '30', '--retries', '3']
  const startedAt = new Date().toISOString()

  const manifest: { streams?: StreamSummary[] } = existsSync(manifestPath)
    ? readJson<{ streams?: StreamSummary[] }>(manifestPath)
    : { streams: [] }
  const knownIds = new Set((manifest.streams ?? []).map(stream => stream.videoId))
  const knownByTitle = new Map<string, number>()
  for (const stream of manifest.streams ?? []) {
    knownByTitle.set(stream.title, Math.max(knownByTitle.get(stream.title) ?? 0, stream.durationSec ?? 0))
  }

  const progress: Record<string, unknown> = {
    startedAt,
    dataset: dataset.id,
    root,
    channelId: dataset.channelId,
    known: knownIds.size,
    phase: 'channel',
  }
  const saveProgress = (): void => {
    writeFileSync(progressPath, `${JSON.stringify({ updatedAt: new Date().toISOString(), ...progress }, null, 2)}\n`, 'utf8')
  }

  const sessions = new Map<string, string>()
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory())
      continue
    const id = /([A-Za-z0-9_-]{11})$/.exec(entry.name)?.[1]
    if (id)
      sessions.set(id, join(root, entry.name))
  }

  saveProgress()
  logFile(logPath, `=== start dataset=${dataset.id} root=${root} known=${knownIds.size} limit=${limit}`)

  void (async () => {
    let channelIds: string[] = []
    if (values.ids) {
      const idsPath = resolve(values.ids)
      channelIds = [...new Set(readFileSync(idsPath, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean))]
      writeFileSync(channelCache, `${channelIds.join('\n')}\n`, 'utf8')
      logFile(logPath, `使用 --ids ${idsPath}：${channelIds.length} 条`)
    }
    else {
      try {
        logFile(logPath, '拉取频道 /streams 列表…')
        const raw = await run('yt-dlp', ['--flat-playlist', '--print', '%(id)s', `https://www.youtube.com/channel/${dataset.channelId}/streams`], true, 1)
        channelIds = [...new Set(raw.split('\n').map(line => line.trim()).filter(id => /^[A-Za-z0-9_-]{11}$/.test(id)))]
        writeFileSync(channelCache, `${channelIds.join('\n')}\n`, 'utf8')
      }
      catch (error) {
        logFile(logPath, `频道列表抓取失败，尝试缓存：${error instanceof Error ? error.message : String(error)}`)
        if (!existsSync(channelCache)) {
          console.error('没有可用的频道列表缓存。可以先用 --ids <文件> 提供视频 ID 列表（每行一个）。')
          process.exit(1)
        }
        channelIds = [...new Set(readFileSync(channelCache, 'utf8').split('\n').map(line => line.trim()).filter(Boolean))]
      }
    }

    const candidates: Candidate[] = channelIds
      .filter(id => !knownIds.has(id))
      .slice(0, limit > 0 ? limit : undefined)
      .map(id => ({ id }))
    progress.channelTotal = channelIds.length
    progress.candidates = candidates.length
    progress.phase = 'meta'
    saveProgress()
    logFile(logPath, `频道 ${channelIds.length} 条 / 已入库 ${knownIds.size} / 候选 ${candidates.length}`)

    if (values['dry-run']) {
      for (const candidate of candidates)
        console.log(candidate.id)
      progress.phase = 'done'
      saveProgress()
      logFile(logPath, `dry-run：${candidates.length} 条候选`)
      return
    }

    const metaFailures: Failure[] = []
    let metaDone = 0
    const metaProgress = { done: 0, total: candidates.length, failed: 0 }
    progress.meta = metaProgress
    logFile(logPath, `开始元信息：${candidates.length} 条（并发 ${metaConcurrency}）`)

    await pool(candidates, metaConcurrency, async (candidate) => {
      try {
        const existing = sessions.get(candidate.id)
        const infoPath = existing ? join(existing, 'meta', 'info.json') : null
        if (existing && infoPath && existsSync(infoPath) && isValidInfoJson(infoPath, candidate.id)) {
          const info = readJson<InfoJson>(infoPath)
          candidate.session = existing
          candidate.info = info
          candidate.title = info.title
          candidate.durationSec = info.duration ?? null
        }
        else {
          const url = `https://www.youtube.com/watch?v=${candidate.id}`
          const raw = await run('yt-dlp', ['-J', ...ytdlpBase, ...cookieArgs, url], true)
          const info = JSON.parse(raw) as InfoJson
          if (info.id !== candidate.id)
            throw new Error(`id 不匹配：${info.id}`)
          const session = `${jstDate(info.release_timestamp ?? info.timestamp)}_${dataset.label}_${info.id}`
          const sessionDir = join(root, session)
          for (const sub of ['meta', 'danmaku', 'comments', 'web', 'work'])
            mkdirSync(join(sessionDir, sub), { recursive: true })
          writeFileSync(join(sessionDir, 'meta', 'info.json'), raw, 'utf8')
          sessions.set(candidate.id, sessionDir)
          candidate.session = sessionDir
          candidate.info = info
          candidate.title = info.title
          candidate.durationSec = info.duration ?? null
        }
        metaDone += 1
        metaProgress.done = metaDone
        saveProgress()
        if (metaDone % 10 === 0 || metaDone === candidates.length)
          logFile(logPath, `meta ${metaDone}/${candidates.length}`)
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/will begin in|Premieres in|premieres in/i.test(message)) {
          candidate.reason = '未来场'
          saveProgress()
          logFile(logPath, `${candidate.id} skip：未来场，暂不抓取`)
          return
        }
        candidate.reason = message
        metaFailures.push({ id: candidate.id, step: 'meta', error: message })
        metaProgress.failed = metaFailures.length
        saveProgress()
        logFile(logPath, `${candidate.id} meta failed: ${message}`)
      }
    })

    // 规划：未来场、同名短摘要
    const skipped: { id: string, reason: string }[] = []
    const usable = candidates.filter((candidate) => {
      if (!candidate.info || !candidate.session) {
        skipped.push({ id: candidate.id, reason: candidate.reason === '未来场' ? '未来场' : '元信息抓取失败' })
        return false
      }
      const status = candidate.info.live_status
      if (status === 'is_upcoming' || status === 'is_live') {
        skipped.push({ id: candidate.id, reason: `跳过：${status}` })
        return false
      }
      return true
    })

    const groups = new Map<string, Candidate[]>()
    for (const candidate of usable) {
      const title = candidate.title ?? ''
      groups.set(title, [...(groups.get(title) ?? []), candidate])
    }
    for (const [title, list] of groups) {
      const knownDuration = knownByTitle.get(title)
      if (knownDuration != null && list.every(item => (item.durationSec ?? 0) < knownDuration * 0.6)) {
        for (const item of list)
          skipped.push({ id: item.id, reason: `同名摘要（已入库 ${knownDuration}s）` })
        continue
      }
      if (list.length > 1) {
        const longest = Math.max(...list.map(item => item.durationSec ?? 0))
        for (const item of list) {
          if ((item.durationSec ?? 0) < longest * 0.6)
            skipped.push({ id: item.id, reason: `同名摘要（正片 ${longest}s）` })
        }
      }
    }

    const skipIds = new Set(skipped.map(item => item.id))
    const kept = usable.filter(candidate => !skipIds.has(candidate.id))
    progress.phase = 'media'
    progress.skipped = skipped
    progress.metaFailures = metaFailures
    progress.plan = { kept: kept.length, skipped: skipped.length }
    saveProgress()
    logFile(logPath, `plan：可抓 ${kept.length} / 跳过 ${skipped.length} / 元信息失败 ${metaFailures.length}`)

    const failures: Failure[] = []
    const media = { done: 0, total: kept.length, chat: 0, comments: 0, vstats: 0 }
    progress.media = media
    progress.failures = failures

    const buildSessions = async (dirs: string[]): Promise<void> => {
      if (values['no-build'] || dirs.length === 0)
        return
      try {
        await run('bun', [DATAPACK_SCRIPT, '--dataset', dataset.id, ...dirs], false, 1)
        progress.build = { chunks: Number((progress.build as { chunks?: number } | undefined)?.chunks ?? 0) + 1, sessions: dirs.length }
        logFile(logPath, `build ok：${dirs.length} 场`)
      }
      catch (error) {
        logFile(logPath, `build failed：${error instanceof Error ? error.message : String(error)}`)
        failures.push({ id: dirs.join(','), step: 'build', error: error instanceof Error ? error.message : String(error) })
      }
      saveProgress()
    }

    const fetchMedia = async (candidate: Candidate): Promise<void> => {
      const session = candidate.session
      if (!session)
        throw new Error('缺少 session')
      const id = candidate.id
      const addFailure = (step: string, error: unknown): void => {
        const message = error instanceof Error ? error.message : String(error)
        failures.push({ id, step, error: message })
        logFile(logPath, `${id} ${step} failed：${message}`)
      }

      // 弹幕回放
      const jsonlPath = join(session, 'danmaku', `danmaku_${id}.jsonl`)
      const chatUnavailable = join(session, 'work', 'chat-unavailable.txt')
      if (!existsSync(jsonlPath) && !existsSync(chatUnavailable)) {
        try {
          const chatFile = join(session, 'danmaku', `${id}.live_chat.json`)
          if (!existsSync(chatFile)) {
            await run('yt-dlp', [...cookieArgs, ...ytdlpBase, '--skip-download', '--write-subs', '--sub-langs', 'live_chat', '-o', join(session, 'danmaku', '%(id)s.%(ext)s'), `https://www.youtube.com/watch?v=${id}`], false)
          }
          if (existsSync(chatFile)) {
            try {
              await normalizeLiveChat(chatFile, jsonlPath, id)
              media.chat += 1
            }
            catch (error) {
              unlinkSync(chatFile)
              throw error
            }
          }
          else {
            writeFileSync(chatUnavailable, 'no live_chat replay\n', 'utf8')
          }
        }
        catch (error) {
          addFailure('chat', error)
        }
      }

      // 评论
      const commentsPath = join(session, 'comments', `comments_${id}.json`)
      if (!existsSync(commentsPath) || !isValidInfoJson(commentsPath, id)) {
        try {
          if (existsSync(commentsPath))
            unlinkSync(commentsPath)
          const raw = await run('yt-dlp', ['-J', '--write-comments', ...ytdlpBase, ...cookieArgs, `https://www.youtube.com/watch?v=${id}`], true)
          writeFileSync(commentsPath, raw, 'utf8')
          media.comments += 1
        }
        catch (error) {
          addFailure('comments', error)
        }
      }

      // VSTATS
      const vstatsPath = join(session, 'web', `vstats_video_${id}.html`)
      const vstatsUnavailable = join(session, 'work', 'vstats-unavailable.txt')
      if ((!existsSync(vstatsPath) || statSync(vstatsPath).size < 1000) && !existsSync(vstatsUnavailable)) {
        try {
          if (existsSync(vstatsPath))
            unlinkSync(vstatsPath)
          const response = await fetch(`https://www.vstats.jp/video/${id}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(20000),
          })
          const html = await response.text()
          if (html.length > 1000) {
            writeFileSync(vstatsPath, html, 'utf8')
            media.vstats += 1
          }
          else {
            writeFileSync(vstatsUnavailable, `empty ${html.length} bytes\n`, 'utf8')
          }
        }
        catch (error) {
          addFailure('vstats', error)
        }
      }

      writeFileSync(join(session, 'work', 'batch-status.json'), `${JSON.stringify({
        id,
        date: jstDate(candidate.info?.release_timestamp ?? candidate.info?.timestamp),
        title: candidate.title,
        session: session.split(/[\\/]/).at(-1),
        durationSec: candidate.durationSec,
        availability: candidate.info?.availability,
        chat: existsSync(jsonlPath),
        comments: existsSync(commentsPath),
        vstats: existsSync(vstatsPath),
        updatedAt: new Date().toISOString(),
      }, null, 2)}\n`, 'utf8')
    }

    const chunkSize = buildEvery > 0 ? buildEvery : kept.length || 1
    for (let offset = 0; offset < kept.length; offset += chunkSize) {
      const chunk = kept.slice(offset, offset + chunkSize)
      await pool(chunk, concurrency, async (candidate) => {
        try {
          await fetchMedia(candidate)
          media.done += 1
        }
        catch (error) {
          failures.push({ id: candidate.id, step: 'media', error: error instanceof Error ? error.message : String(error) })
        }
        saveProgress()
        logFile(logPath, `media ${media.done}/${media.total} ${candidate.id} ${candidate.title ?? ''}`)
      })
      await buildSessions(chunk.map(candidate => candidate.session).filter((session): session is string => Boolean(session)))
    }

    // 失败重试一轮
    const stepSatisfied = (session: string, id: string, step: string): boolean => {
      if (step === 'chat')
        return existsSync(join(session, 'danmaku', `danmaku_${id}.jsonl`)) || existsSync(join(session, 'work', 'chat-unavailable.txt'))
      if (step === 'comments')
        return isValidInfoJson(join(session, 'comments', `comments_${id}.json`), id)
      if (step === 'vstats')
        return existsSync(join(session, 'web', `vstats_video_${id}.html`)) || existsSync(join(session, 'work', 'vstats-unavailable.txt'))
      return false
    }

    const previousFailures = [...failures]
    const retryIds = [...new Set(previousFailures.filter(item => item.step !== 'build').map(item => item.id))]
    if (retryIds.length > 0) {
      logFile(logPath, `retry ${retryIds.length} 场失败项`)
      const retryCandidates = kept.filter(candidate => retryIds.includes(candidate.id))
      failures.length = 0
      await pool(retryCandidates, concurrency, async (candidate) => {
        try {
          await fetchMedia(candidate)
        }
        catch {}
      })
      for (const previous of previousFailures) {
        if (failures.some(current => current.id === previous.id && current.step === previous.step))
          continue
        const candidate = kept.find(item => item.id === previous.id)
        if (previous.step !== 'build' && candidate?.session && stepSatisfied(candidate.session, previous.id, previous.step))
          continue
        failures.push(previous)
      }
      await buildSessions(retryCandidates.map(candidate => candidate.session).filter((session): session is string => Boolean(session)))
      logFile(logPath, `retry 完成，剩余失败 ${failures.length}`)
    }

    progress.phase = 'done'
    progress.finishedAt = new Date().toISOString()
    progress.media = media
    saveProgress()
    logFile(logPath, `=== done：media ${media.done}/${media.total}，chat ${media.chat}，comments ${media.comments}，vstats ${media.vstats}，失败 ${failures.length}`)
    console.log(`\n进度文件：${progressPath}`)
    console.log(`日志文件：${logPath}`)
    if (failures.length > 0) {
      console.log(`\n仍有 ${failures.length} 项失败（可重跑同一命令重试）：`)
      for (const failure of failures.slice(0, 20))
        console.log(`  - ${failure.id} [${failure.step}] ${failure.error}`)
      process.exitCode = 1
    }
  })().catch((error) => {
    logFile(logPath, `fatal：${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    process.exit(1)
  })
}

main()
