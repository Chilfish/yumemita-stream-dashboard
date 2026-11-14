/**
 * 只补缺失场次的弹幕回放，不碰 meta / 评论 / VSTATS。
 *
 *   bun run ymmt data danmaku --dataset nonoka --video W0bKqP-Eyj4
 *   bun run ymmt data danmaku --root "D:/projects/claude-messages/temp/youtube-live"
 *   bun run ymmt data danmaku --dataset arale --limit 20 --concurrency 3
 *   bun run ymmt data danmaku --dataset yuno --engine yt-dlp --cookies-from-browser firefox
 *
 * 默认走 InnerTube 回放（`get_live_chat_replay`，匿名可用），与实时采集共用同一套
 * 归一化：消息 / 非消息事件 / 频道表情一起落盘。watch 页没有回放聊天时回退 yt-dlp
 * 的 `live_chat` 字幕（会员限定场次需要 cookie）。
 *
 * 输入默认读 `data/missing-danmaku/<dataset>.txt`（由缺失清单生成）。
 * 已有 `danmaku_<videoId>.jsonl` 或 `work/chat-unavailable.txt` 的场次会跳过，可反复执行。
 *
 * 输出：
 *   <root>/<日期>_<成员>_<videoId>/danmaku/danmaku_<videoId>.jsonl
 *   <root>/<日期>_<成员>_<videoId>/danmaku/events_<videoId>.jsonl   （InnerTube 非消息事件）
 *   <root>/<日期>_<成员>_<videoId>/danmaku/emoji_<videoId>.json      （InnerTube 频道表情）
 *   <root>/<日期>_<成员>_<videoId>/work/chat-unavailable.txt         （没有弹幕回放时）
 *
 * InnerTube 中断后重跑会从 `work/replay-state.json` 接着翻；`--engine yt-dlp`
 * 才下载原始 `.live_chat.json`，成功后默认删掉，加 `--keep-raw` 保留。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Option } from 'commander'
import type { Logger } from '@scripts/lib/cli/logger.ts'
import type { CommandSpec } from '@scripts/lib/cli/runtime.ts'
import { CliError, UsageError } from '@scripts/lib/cli/exit.ts'
import { sentinelIsFresh } from '@scripts/lib/sentinel.ts'
import { normalizeLiveChat } from '@scripts/lib/live-chat.ts'
import { mergeDanmakuFiles } from '@scripts/lib/danmaku-merge.ts'
import { collectReplay } from '@scripts/lib/live-chat-collect.ts'
import { resolveCookies, ytdlpCookieArgs } from '@scripts/lib/yt-cookies.ts'

const APP_ROOT = resolve(import.meta.dir, '../../..')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')
const MISSING_DIR = join(APP_ROOT, 'data', 'missing-danmaku')
const DEFAULT_ENGINE = 'auto'
const DEFAULT_CONCURRENCY = 3
const DEFAULT_PAGE_DELAY_MS = 150
const DEFAULT_COOKIE_BROWSER = 'firefox'

interface DatasetSource {
  id: string
  label: string
  datapackDir: string
}

const ENGINE_NAMES = new Set(['auto', 'innertube', 'yt-dlp'])
type Engine = 'auto' | 'innertube' | 'yt-dlp'

/** 注入的日志器；默认静默，方便测试与进程内调用。 */
export type CommandLog = Pick<Logger, 'info' | 'warn' | 'error'>

const SILENT_LOG: CommandLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

export interface DanmakuFailure {
  dataset: string
  videoId: string
  error: string
}

export interface RunDanmakuOptions {
  /** 只处理指定 dataset，可重复；默认读 data/missing-danmaku/ 下全部。 */
  dataset?: string[]
  /** 原始会话根目录（默认 $STREAM_SESSION_ROOT 或 ./temp/youtube-live）。 */
  root?: string
  /** 直接指定视频 ID，可重复；需同时指定一个 dataset。 */
  video?: string[]
  /** 直接读 videoId 列表（每行一个），需同时指定一个 dataset。 */
  ids?: string
  /** 并发，默认 3。 */
  concurrency?: number
  /** 本次最多处理 n 场，0 = 全部。 */
  limit?: number
  /** 多实例分片：只处理第 i 片（1 起），例如 1/4、2/4。 */
  shard?: string
  /** auto / innertube / yt-dlp，默认 auto。 */
  engine?: string
  /** 已有 jsonl 也重抓；InnerTube 会从头翻并与旧档合并。 */
  force?: boolean
  /** 保留原始 .live_chat.json（仅 yt-dlp 引擎）。 */
  keepRaw?: boolean
  /** InnerTube 的 Cookie 请求头（会员限定需要）；也可用 YT_COOKIE。 */
  cookie?: string
  /** Netscape cookie jar；InnerTube 直接读，yt-dlp 传 --cookies。 */
  cookies?: string
  /** 导出 cookie / yt-dlp 回退时用哪个浏览器，默认 firefox。 */
  cookiesFromBrowser?: string
  /** cookie 缓存路径，默认 ~/yt-cookies.txt。 */
  cookieCache?: string
  /** 不使用 cookie，以匿名状态抓取。 */
  noCookies?: boolean
  /** InnerTube 每页间隔，默认 150ms。 */
  pageDelay?: number
  /** InnerTube 最多翻多少页，0 = 不限（安全阀）。 */
  maxPages?: number
  /** 不读 work/replay-state.json，从 watch 页重新翻。 */
  noResume?: boolean
  /** 不强制 IPv4（仅 yt-dlp 引擎）。 */
  noForceIpv4?: boolean
  /** 只列出候选。 */
  dryRun?: boolean
  /** 注入的日志器；默认静默。 */
  log?: CommandLog
}

export interface DanmakuRunResult {
  root: string
  engine: Engine
  total: number
  ok: number
  skipped: number
  unavailable: number
  failed: number
  failures: DanmakuFailure[]
  /** dry-run 时的候选清单（`<datasetId>\t<videoId>`）。 */
  candidates: string[]
}

interface Task { source: DatasetSource, videoId: string }

/** 接受裸 videoId 或完整 URL；非法输入直接报错，避免把垃圾写进清单。 */
function normalizeVideoId(raw: string): string {
  const trimmed = raw.trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed))
    return trimmed
  const match = /(?:v=|youtu\.be\/|\/live\/)([A-Za-z0-9_-]{11})/.exec(trimmed)
  if (match)
    return match[1]!
  throw new UsageError(`不是有效的 videoId 或 YouTube 链接：${raw}`, {
    hint: '传 11 位 videoId，或 https://www.youtube.com/watch?v=<id> 形式的完整链接',
    context: { value: raw },
  })
}

async function runYtdlp(args: string[]): Promise<{ code: number, stderr: string }> {
  const proc = Bun.spawn(['yt-dlp', ...args], { cwd: APP_ROOT, stdout: 'pipe', stderr: 'pipe' })
  const stderrPromise = new Response(proc.stderr).text()
  await new Response(proc.stdout).text()
  const code = await proc.exited
  return { code, stderr: await stderrPromise }
}

async function runPool<T>(items: T[], size: number, task: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    for (;;) {
      const item = items[cursor]
      cursor += 1
      if (item === undefined)
        return
      await task(item)
    }
  })
  await Promise.all(workers)
}

/**
 * 补齐缺失场次的弹幕回放（InnerTube 优先，必要时回退 yt-dlp 字幕）。
 *
 * 进程内可调用（`data fetch` / `data update` 用它替代 spawn）：不读 process.argv、
 * 不调用 process.exit，进度走注入的 `log`；单场失败只记录，不阻塞其余场次。
 */
export async function runDanmaku(options: RunDanmakuOptions = {}): Promise<{ exitCode: number, data?: DanmakuRunResult }> {
  const log = options.log ?? SILENT_LOG

  const engineRaw = options.engine ?? DEFAULT_ENGINE
  if (!ENGINE_NAMES.has(engineRaw)) {
    throw new UsageError(`--engine 只支持 auto / innertube / yt-dlp，收到：${engineRaw}`, {
      hint: '例如 --engine innertube；默认 auto 会先试 InnerTube 再回退 yt-dlp',
      context: { option: 'engine', value: engineRaw },
    })
  }
  const engine = engineRaw as Engine

  const root = resolve(options.root ?? process.env.STREAM_SESSION_ROOT ?? join(APP_ROOT, 'temp', 'youtube-live'))
  if (!existsSync(root)) {
    throw new CliError('请用 --root 指定归档的会话根目录（或设置 STREAM_SESSION_ROOT）', {
      code: 'MISSING_SESSION_ROOT',
      hint: `创建会话根目录后用 --root 指过去，例如 --root ${join(APP_ROOT, 'temp', 'youtube-live')}`,
      context: { root },
    })
  }

  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)
  const limit = Math.max(0, options.limit ?? 0)
  const force = options.force === true
  const dryRun = options.dryRun === true
  const forceIpv4 = options.noForceIpv4 !== true
  const pageDelayMs = Math.max(0, options.pageDelay ?? DEFAULT_PAGE_DELAY_MS)
  const maxPages = Math.max(0, options.maxPages ?? 0)
  const browser = options.cookiesFromBrowser ?? DEFAULT_COOKIE_BROWSER
  const keepRaw = options.keepRaw === true

  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { datasets: DatasetSource[] }
  const byId = new Map(config.datasets.map(source => [source.id, source]))
  const requestedDatasets = options.dataset ?? []
  const selected = requestedDatasets.length > 0
    ? requestedDatasets.map((id) => {
        const source = byId.get(id)
        if (!source) {
          throw new CliError(`data-sources.json 里没有 dataset：${id}`, {
            code: 'UNKNOWN_DATASET',
            hint: `可用：${config.datasets.map(source => source.id).join(', ') || '(空)'}`,
            context: { dataset: id },
          })
        }
        return source
      })
    : config.datasets

  const explicitVideo = options.video ?? []
  if ((options.ids || explicitVideo.length > 0) && selected.length !== 1) {
    throw new UsageError('用 --ids / --video 时请同时指定且只指定一个 --dataset，避免把 ID 写进错误的成员目录', {
      hint: '例如 --dataset yuno --video <videoId>',
      context: { datasets: selected.map(source => source.id) },
    })
  }

  function readDirectIds(): string[] | null {
    if (explicitVideo.length === 0 && !options.ids)
      return null
    const ids: string[] = []
    for (const raw of explicitVideo)
      ids.push(normalizeVideoId(raw))
    if (options.ids) {
      const path = resolve(options.ids)
      if (!existsSync(path)) {
        throw new CliError(`找不到 ID 列表：${path}`, {
          code: 'MISSING_IDS_FILE',
          hint: '确认 --ids 的路径，或用 --video 单个指定',
          context: { path },
        })
      }
      ids.push(...readFileSync(path, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(normalizeVideoId))
    }
    return [...new Set(ids)]
  }

  function readIds(source: DatasetSource): string[] {
    const direct = readDirectIds()
    if (direct)
      return direct
    const path = join(MISSING_DIR, `${source.id}.txt`)
    if (!existsSync(path))
      return []
    return readFileSync(path, 'utf8').split('\n').map(line => line.trim()).filter(Boolean)
  }

  /** 目录名以 `_<videoId>` 结尾；只建一次索引，供所有 dataset 共用。 */
  function buildSessionIndex(): Map<string, string> {
    const map = new Map<string, string>()
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.'))
        continue
      const match = /_([A-Za-z0-9_-]{11})$/.exec(entry.name)
      if (match && !map.has(match[1]!))
        map.set(match[1]!, join(root, entry.name))
    }
    return map
  }

  const sessions = buildSessionIndex()

  function packDate(source: DatasetSource, videoId: string): string | null {
    const path = join(APP_ROOT, source.datapackDir, `${videoId}.datapack.json`)
    if (!existsSync(path))
      return null
    try {
      const pack = JSON.parse(readFileSync(path, 'utf8')) as { video?: { startedAt?: string | null } }
      return pack.video?.startedAt?.slice(0, 10) ?? null
    }
    catch {
      return null
    }
  }

  function sessionDir(source: DatasetSource, videoId: string): string {
    const existing = sessions.get(videoId)
    if (existing)
      return existing
    const date = packDate(source, videoId) ?? 'unknown'
    return join(root, `${date}_${source.label}_${videoId}`)
  }

  let allTasks: Task[] = []
  for (const source of selected) {
    for (const videoId of readIds(source))
      allTasks.push({ source, videoId })
  }

  let shardIndex = 0
  let shardTotal = 1
  if (options.shard) {
    const match = /^(\d+)\/(\d+)$/.exec(options.shard.trim())
    shardIndex = Number(match?.[1])
    shardTotal = Number(match?.[2])
    if (!match || !Number.isInteger(shardIndex) || !Number.isInteger(shardTotal)
      || shardTotal < 1 || shardIndex < 1 || shardIndex > shardTotal) {
      throw new UsageError(`--shard 格式应为 i/n（1 <= i <= n），收到：${options.shard}`, {
        hint: '例如 --shard 1/4；第 i 片从 1 起',
        context: { option: 'shard', value: options.shard },
      })
    }
    allTasks = allTasks.filter((_, index) => index % shardTotal === shardIndex - 1)
  }

  const tasks = allTasks
  const shardNote = options.shard ? `，分片 ${shardIndex}/${shardTotal}` : ''

  if (dryRun) {
    const visible = tasks.slice(0, limit || tasks.length)
    const candidates = visible.map(task => `${task.source.id}\t${task.videoId}`)
    for (const line of candidates)
      log.info(line)
    log.info(`候选 ${tasks.length} 场（${selected.map(s => s.id).join(', ')}）${shardNote}`)
    return {
      exitCode: 0,
      data: {
        root,
        engine,
        total: tasks.length,
        ok: 0,
        skipped: 0,
        unavailable: 0,
        failed: 0,
        failures: [],
        candidates,
      },
    }
  }

  // cookie 默认每次运行重新导出到 ~/yt-cookies.txt，随后 InnerTube 与 yt-dlp 共用。
  const resolvedCookies = await resolveCookies({
    cookie: options.cookie,
    cookies: options.cookies,
    envCookie: process.env.YT_COOKIE,
    browser,
    cachePath: options.cookieCache,
    disable: options.noCookies,
    url: tasks[0] ? `https://www.youtube.com/watch?v=${tasks[0].videoId}` : undefined,
    appRoot: APP_ROOT,
    log: line => log.info(line),
  })
  if (resolvedCookies.source === 'cache' && resolvedCookies.jarPath)
    log.info(`cookie：复用缓存 ${resolvedCookies.jarPath}`)
  else if (resolvedCookies.source === 'none' && resolvedCookies.note)
    log.info(resolvedCookies.note)
  const cookieArgs = ytdlpCookieArgs(resolvedCookies, { browser })
  const innerTubeCookie = resolvedCookies.header

  let ok = 0
  let skipped = 0
  let unavailable = 0
  let failed = 0
  const failures: DanmakuFailure[] = []
  const todo = limit > 0 ? tasks.slice(0, limit) : tasks
  const started = Date.now()

  /** InnerTube 中断后 state 里仍有续页；这时即使 jsonl 存在也不算完成。 */
  function replayIncomplete(session: string, videoId: string): boolean {
    const path = join(session, 'work', 'replay-state.json')
    if (!existsSync(path))
      return false
    try {
      const state = JSON.parse(readFileSync(path, 'utf8')) as {
        videoId?: string
        continuation?: string | null
        stopReason?: string | null
      }
      return state.videoId === videoId && Boolean(state.continuation) && state.stopReason !== 'done'
    }
    catch {
      return false
    }
  }

  /** yt-dlp 回退：下载 `live_chat` 字幕并归一化，再与实时采集合并。 */
  async function collectWithYtdlp(videoId: string, danmakuDir: string): Promise<'done' | 'unavailable'> {
    const jsonlPath = join(danmakuDir, `danmaku_${videoId}.jsonl`)
    const rawPath = join(danmakuDir, `${videoId}.live_chat.json`)
    if (!existsSync(rawPath)) {
      const args = [
        ...cookieArgs,
        '--no-warnings',
        '--no-cache-dir',
        '--socket-timeout',
        '60',
        '--retries',
        '5',
        ...(forceIpv4 ? ['--force-ipv4'] : []),
        '--skip-download',
        '--write-subs',
        '--sub-langs',
        'live_chat',
        '-o',
        join(danmakuDir, '%(id)s.%(ext)s'),
        `https://www.youtube.com/watch?v=${videoId}`,
      ]
      const result = await runYtdlp(args)
      if (result.code !== 0) {
        const detail = result.stderr.split('\n').filter(Boolean).at(-1) ?? `yt-dlp exit ${result.code}`
        throw new Error(detail)
      }
    }

    if (!existsSync(rawPath))
      return 'unavailable'

    const normalized = await normalizeLiveChat(rawPath, jsonlPath, videoId)
    if (normalized.duplicates > 0)
      log.info(`${videoId} 字幕内重复 ${normalized.duplicates} 条已按 rendererId 去重`)
    const livePath = join(danmakuDir, `danmaku_live_${videoId}.jsonl`)
    if (existsSync(livePath)) {
      try {
        const merged = mergeDanmakuFiles([jsonlPath, livePath], jsonlPath)
        log.info(`${videoId} 合并实时采集：${merged.before} + ${merged.added} → ${merged.after}（重复 ${merged.duplicates}）`)
      }
      catch (error) {
        log.error(`${videoId} 合并实时采集失败，保留回放：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (!keepRaw)
      unlinkSync(rawPath)
    return 'done'
  }

  log.info(`${todo.length} 场，并发 ${concurrency}，引擎 ${engine}，root=${root}${shardNote}`)

  await runPool(todo, concurrency, async ({ source, videoId }) => {
    const session = sessionDir(source, videoId)
    const danmakuDir = join(session, 'danmaku')
    const jsonlPath = join(danmakuDir, `danmaku_${videoId}.jsonl`)
    const unavailablePath = join(session, 'work', 'chat-unavailable.txt')

    if (!force && existsSync(jsonlPath) && !(engine !== 'yt-dlp' && replayIncomplete(session, videoId))) {
      skipped += 1
      return
    }
    if (!force && sentinelIsFresh(unavailablePath)) {
      skipped += 1
      return
    }

    try {
      mkdirSync(danmakuDir, { recursive: true })
      mkdirSync(join(session, 'work'), { recursive: true })

      let done = false
      if (engine !== 'yt-dlp') {
        const result = await collectReplay({
          videoId,
          session,
          cookie: innerTubeCookie,
          pageDelayMs,
          maxPages,
          resume: !force && !options.noResume,
          log: line => log.info(line),
        })
        if (result.status === 'done') {
          done = true
        }
        else if (result.status === 'partial') {
          throw new Error(`InnerTube 回放未完成（${result.total} 条，${result.error ?? '中断'}）；重跑会从断点续翻`)
        }
        else if (result.status === 'live') {
          throw new Error('直播尚未结束，实时采集请用 fetch:live-chat')
        }
        else if (result.status === 'failed' && engine === 'innertube') {
          throw new Error(result.error ?? 'InnerTube 回放失败')
        }
        else if (result.status === 'failed') {
          log.info(`${videoId} InnerTube 失败（${result.error ?? 'unknown'}），回退 yt-dlp`)
        }
        else if (result.status === 'no-replay' && engine === 'auto') {
          log.info(`${videoId} watch 页没有回放聊天，回退 yt-dlp`)
        }
      }

      if (!done) {
        if (engine === 'innertube') {
          // 显式指定 InnerTube 时不再回退 yt-dlp；没有回放就是没有。
          writeFileSync(unavailablePath, 'no live_chat replay\n', 'utf8')
          unavailable += 1
          return
        }
        const outcome = await collectWithYtdlp(videoId, danmakuDir)
        if (outcome === 'unavailable') {
          writeFileSync(unavailablePath, 'no live_chat replay\n', 'utf8')
          unavailable += 1
          return
        }
      }

      if (existsSync(unavailablePath))
        unlinkSync(unavailablePath)
      ok += 1
    }
    catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ dataset: source.id, videoId, error: message })
      log.error(`${source.id}/${videoId} 失败：${message}`)
    }
    finally {
      const done = ok + skipped + unavailable + failed
      if (done % 10 === 0)
        log.info(`${done}/${todo.length}  ok=${ok} skip=${skipped} no-replay=${unavailable} fail=${failed}`)
    }
  })

  if (failures.length > 0) {
    const failedBase = shardTotal > 1 ? `failed-${shardIndex}-of-${shardTotal}` : 'failed'
    writeFileSync(
      join(MISSING_DIR, `${failedBase}.json`),
      `${JSON.stringify({ generatedAt: new Date().toISOString(), failures }, null, 2)}\n`,
      'utf8',
    )
    writeFileSync(
      join(MISSING_DIR, `${failedBase}.txt`),
      `${failures.map(failure => failure.videoId).join('\n')}\n`,
      'utf8',
    )
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(0)
  log.info(`完成：新增 ${ok} / 跳过 ${skipped} / 无回放 ${unavailable} / 失败 ${failed}（${seconds}s）`)
  if (failures.length > 0)
    log.info(`失败清单：${join(MISSING_DIR, 'failed.json')}`)

  return {
    exitCode: failed > 0 ? 1 : 0,
    data: { root, engine, total: todo.length, ok, skipped, unavailable, failed, failures, candidates: [] },
  }
}

function stringList(value: unknown): string[] | undefined {
  if (typeof value === 'string' && value.length > 0)
    return [value]
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    return items.length > 0 ? items : undefined
  }
  return undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** `--no-x` 形式的开关在 commander 里是 `<x>: false`；布尔 false 才说明显式传了。 */
function negated(ctx: { options: Record<string, unknown> }, name: string): boolean {
  return ctx.options[name] === false
}

/** `data danmaku`：只抓缺失场次的弹幕回放。 */
export const dataDanmakuSpec: CommandSpec<DanmakuRunResult> = {
  id: 'data.danmaku',
  description: '只抓缺失场次的弹幕回放，补齐 jsonl（InnerTube 优先，回退 yt-dlp）',
  details: '只抓缺失场次的弹幕回放，不重新抓 meta / 评论 / VSTATS。输入默认读 '
    + 'data/missing-danmaku/<datasetId>.txt；已有 danmaku_<videoId>.jsonl 或 '
    + 'work/chat-unavailable.txt 的场次会跳过，可反复执行。\n\n'
    + 'InnerTube 回放匿名可用；被删除 / 封禁账号的历史消息只在 yt-dlp 字幕档里，'
    + '需要完整历史时对已有场次用 --force --engine yt-dlp 再抓一次。\n'
    + '会员限定的实时 / 回放需要 cookie；失败会打印并保留在清单里，下次重跑。',
  examples: [
    'bun run ymmt data danmaku --dataset nonoka --video W0bKqP-Eyj4',
    'bun run ymmt data danmaku --dataset arale --limit 20 --concurrency 3',
    'bun run ymmt data danmaku --dataset yuno --engine yt-dlp --cookies-from-browser firefox',
    'bun run ymmt data danmaku --dataset yuno --shard 1/4 --json',
  ],
  options: [
    new Option('--dataset <id>', '只处理指定 dataset，可重复；默认读 data/missing-danmaku/ 下全部')
      .argParser((value: string, previous: string[] | undefined) => [...(previous ?? []), value]),
    new Option('--root <目录>', '原始会话根目录（默认 $STREAM_SESSION_ROOT 或 ./temp/youtube-live）'),
    new Option('--video <id>', '直接指定视频 ID，可重复；需同时指定一个 --dataset')
      .argParser((value: string, previous: string[] | undefined) => [...(previous ?? []), value]),
    new Option('--ids <文件>', '直接读 videoId 列表（每行一个），需同时指定一个 --dataset'),
    new Option('--engine <auto|innertube|yt-dlp>', '默认 auto：InnerTube 回放优先，无回放时回退 yt-dlp').default(DEFAULT_ENGINE),
    new Option('--concurrency <n>', `并发，默认 ${DEFAULT_CONCURRENCY}`).default(DEFAULT_CONCURRENCY),
    new Option('--limit <n>', '本次最多处理 n 场（按 --ids / --dataset 顺序），0 = 全部').default(0),
    new Option('--shard <i/n>', '多实例分片：只处理第 i 片（1 起），例如 1/4、2/4'),
    new Option('--force', '已有 jsonl 也重抓；InnerTube 会从头翻并与旧档合并'),
    new Option('--keep-raw', '保留原始 .live_chat.json（仅 yt-dlp 引擎）'),
    new Option('--cookie <字符串>', 'InnerTube 的 Cookie 请求头（会员限定需要）；也可用 YT_COOKIE'),
    new Option('--cookies <文件>', 'Netscape cookie jar；InnerTube 直接读，yt-dlp 传 --cookies'),
    new Option('--cookies-from-browser <b>', `导出 cookie / yt-dlp 回退时用哪个浏览器，默认 ${DEFAULT_COOKIE_BROWSER}`).default(DEFAULT_COOKIE_BROWSER),
    new Option('--cookie-cache <文件>', 'cookie 缓存路径，默认 ~/yt-cookies.txt'),
    new Option('--no-cookies', '不使用 cookie，以匿名状态抓取'),
    new Option('--page-delay <ms>', `InnerTube 每页间隔，默认 ${DEFAULT_PAGE_DELAY_MS}`).default(String(DEFAULT_PAGE_DELAY_MS)),
    new Option('--max-pages <n>', 'InnerTube 最多翻多少页，0 = 不限（安全阀）').default(0),
    new Option('--no-resume', '不读 work/replay-state.json，从 watch 页重新翻'),
    new Option('--no-force-ipv4', '不强制 IPv4（仅 yt-dlp 引擎）'),
  ],
  async run(ctx) {
    const result = await runDanmaku({
      dataset: stringList(ctx.options.dataset),
      root: optionalString(ctx.options.root),
      video: stringList(ctx.options.video),
      ids: optionalString(ctx.options.ids),
      concurrency: ctx.integer('concurrency', DEFAULT_CONCURRENCY, 1),
      limit: ctx.integer('limit', 0, 0),
      shard: optionalString(ctx.options.shard),
      engine: optionalString(ctx.options.engine) ?? DEFAULT_ENGINE,
      force: ctx.flag('force'),
      keepRaw: ctx.flag('keepRaw'),
      cookie: optionalString(ctx.options.cookie),
      cookies: optionalString(ctx.options.cookies),
      cookiesFromBrowser: optionalString(ctx.options.cookiesFromBrowser) ?? DEFAULT_COOKIE_BROWSER,
      cookieCache: optionalString(ctx.options.cookieCache),
      noCookies: negated(ctx, 'cookies'),
      pageDelay: ctx.integer('pageDelay', DEFAULT_PAGE_DELAY_MS, 0),
      maxPages: ctx.integer('maxPages', 0, 0),
      noResume: negated(ctx, 'resume'),
      noForceIpv4: negated(ctx, 'forceIpv4'),
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    return { exitCode: result.exitCode, data: result.data }
  },
}
