#!/usr/bin/env bun
/**
 * 手动添加官方账号的联动场次。
 *
 *   bun run ymmt data official "https://www.youtube.com/watch?v=Jih2ArVViRo" --participants arale,nonoka
 *   bun run ymmt data official Jih2ArVViRo --participants all
 *   bun run ymmt data official Jih2ArVViRo --participants yuno --dataset other --dry-run
 *
 * 用途：成员频道与两个固定官方号之外，第三方官方账号偶尔也会办本团出演的直播。
 * 这类场次的参与者无法从标题或简介可靠推断（实测 71 场团体号标题只有 1 场写了成员名），
 * 必须由人指定。命令把结果落到 `data/<officialId>/`，并按现有渠道写库与发布。
 *
 * 归属规则：
 * - 默认落到聚合账号 `other`（`kind: official`，`sync: manual`），不污染成员口径。
 * - `--dataset <id>` 可指向任意已配置的官方账号；指向成员会被拒绝。
 *
 * 参与者规则：
 * - `--participants all` 展开为全部成员。
 * - 否则是成员 id 列表，逗号分隔、可重复传入；未知 id 直接报错，不做静默丢弃。
 * - 写入 `content/collaborations.json`，由 ingest 落到 `streams.participants`。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Option } from 'commander'
import { type CommandSpec, CliError, UsageError, type Logger } from '@chilfish/devkit/cli'
import { devkit } from '../../dev.config.ts'
import { applyOnlineEnv, readOnlineTarget } from '@scripts/lib/online-env.ts'
import { parseVideoRef } from '@scripts/lib/video-ref.ts'
import {
  FALLBACK_OFFICIAL_ID,
  resolveOfficialDataset,
  resolveParticipantArgs,
} from '@scripts/lib/official-stage.ts'
import { DEFAULT_COOKIE_BROWSER, resolveCookies, ytdlpCookieArgs } from '@scripts/lib/yt-cookies.ts'
import { runIngest } from '../db/ingest.ts'
import { runVerify } from '../db/verify.ts'
import { runPublishData } from '../publish/data.ts'
import { runPurge } from '../publish/purge.ts'
import { runFetch } from './fetch.ts'

const APP_ROOT = resolve(import.meta.dir, '../../..')
const DATASOURCES_PATH = join(APP_ROOT, 'data-sources.json')
const COLLABORATIONS_PATH = join(APP_ROOT, 'content', 'collaborations.json')

interface DatasetSource {
  id: string
  label: string
  kind?: 'member' | 'official'
  sync?: 'channel' | 'filtered' | 'manual'
  channelId?: string | null
  manifest: string
  datapackDir: string
}

interface VideoInfo {
  id: string
  title?: string
  channel?: string
  channel_id?: string
  release_timestamp?: number
  timestamp?: number
  duration?: number
  live_status?: string
}

interface CollaborationsFile {
  schema?: string
  streams?: Record<string, string[]>
}

function readDatasets(): DatasetSource[] {
  const config = JSON.parse(readFileSync(DATASOURCES_PATH, 'utf8')) as { datasets?: DatasetSource[] }
  return config.datasets ?? []
}

function members(datasets: DatasetSource[]): DatasetSource[] {
  return datasets.filter(item => (item.kind ?? 'member') === 'member')
}

function runYtDlpJson(videoId: string, cookieArgs: string[]): Promise<VideoInfo> {
  const proxy = process.env.YTDLP_PROXY
  const args = [
    '-J',
    '--socket-timeout',
    '30',
    '--retries',
    '2',
    ...(proxy ? ['--proxy', proxy] : []),
    ...cookieArgs,
    `https://www.youtube.com/watch?v=${videoId}`,
  ]
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout?.on('data', chunk => out.push(chunk as Buffer))
    child.stderr?.on('data', chunk => err.push(chunk as Buffer))
    child.on('error', rejectPromise)
    child.on('close', (code) => {
      if (code === 0) {
        try {
          resolvePromise(JSON.parse(Buffer.concat(out).toString('utf8')) as VideoInfo)
        }
        catch (error) {
          rejectPromise(error)
        }
        return
      }
      const stderr = Buffer.concat(err).toString('utf8').trim().split('\n').slice(-3).join(' | ')
      rejectPromise(new Error(`yt-dlp exit ${code}: ${stderr}`))
    })
  })
}

/** 把 videoId → 参与者写进登记文件；已存在则覆盖。返回写入后的条目数。 */
export function registerParticipants(
  videoId: string,
  participants: string[],
): { total: number, previous: string[] | null } {
  const file: CollaborationsFile = existsSync(COLLABORATIONS_PATH)
    ? JSON.parse(readFileSync(COLLABORATIONS_PATH, 'utf8')) as CollaborationsFile
    : { schema: 'yumemita.stream-collaborations/v1', streams: {} }

  const streams = file.streams ?? {}
  const previous = streams[videoId] ?? null
  streams[videoId] = participants
  file.schema = file.schema ?? 'yumemita.stream-collaborations/v1'
  file.streams = streams

  // 与现有登记文件保持一致：按 videoId 排序、2 空格缩进、末尾换行。
  const sorted = Object.fromEntries(
    Object.entries(streams).sort(([left], [right]) => left.localeCompare(right)),
  )
  writeFileSync(
    COLLABORATIONS_PATH,
    `${JSON.stringify({ schema: file.schema, streams: sorted }, null, 2)}\n`,
    'utf8',
  )
  return { total: Object.keys(sorted).length, previous }
}

export interface OfficialAddOptions {
  ref: string
  participants: string[]
  dataset?: string
  root?: string
  online?: boolean
  verify?: boolean
  cookies?: string
  cookiesFromBrowser?: string
  anonymous?: boolean
  dryRun?: boolean
  log: Logger
}

export interface OfficialAddResult {
  videoId: string
  dataset: string
  channel: { id: string | null, name: string | null }
  title: string
  participants: string[]
  registered: boolean
  steps: string[]
  verifyProblems: number
}

function assertStep(result: { exitCode: number }, label: string, hint: string): void {
  if (result.exitCode === 0)
    return
  throw new CliError(`${label} 失败（exit ${result.exitCode}）`, { hint })
}

/**
 * 手动添加一场官方联动直播。
 *
 * 顺序：拉元信息确认场次 → 解析参与者与归属 → 登记 → 抓素材 / 建 pack →
 * 本地 ingest → 线上 ingest → verify → publish → purge。
 */
export async function runOfficialAdd(
  options: OfficialAddOptions,
): Promise<{ exitCode: number, data?: OfficialAddResult }> {
  const { log } = options
  const videoId = parseVideoRef(options.ref)
  const datasets = readDatasets()
  if (datasets.length === 0)
    throw new CliError('data-sources.json 里没有 datasets', { hint: '先配置成员与官方账号' })

  const target = resolveOfficialDataset(datasets, options.dataset)
  const participants = resolveParticipantArgs(options.participants, datasets, {
    excludeId: target.id,
  })

  const cookies = await resolveCookies({
    cookies: options.cookies,
    envCookie: process.env.YT_COOKIE,
    browser: options.cookiesFromBrowser ?? DEFAULT_COOKIE_BROWSER,
    disable: options.anonymous === true,
    appRoot: APP_ROOT,
    log: line => log.info(`[official] ${line}`),
  })
  const cookieArgs = ytdlpCookieArgs(cookies, {
    browser: options.cookiesFromBrowser ?? DEFAULT_COOKIE_BROWSER,
  })

  log.info(`获取元信息：${videoId}`)
  const info = await runYtDlpJson(videoId, cookieArgs)
  if (info.id !== videoId)
    throw new CliError(`元信息里的视频 ID 不匹配：${info.id}`, { context: { videoId } })

  const liveStatus = info.live_status ?? null
  if (liveStatus === 'is_upcoming' || liveStatus === 'is_live') {
    throw new CliError(`${videoId} 还没结束（${liveStatus}）`, {
      hint: '等直播结束后再添加；未来场次走 /admin/schedule 或日程同步',
      context: { videoId, liveStatus },
    })
  }

  const membersOnStage = participants
  log.info(
    `归属：${target.label}（${target.id}）`
    + ` · 参与者：${membersOnStage.join(', ')}`
    + ` · 原频道：${info.channel ?? '(未知)'}${info.channel_id ? ` (${info.channel_id})` : ''}`,
  )

  if (options.dryRun) {
    return {
      exitCode: 0,
      data: {
        videoId,
        dataset: target.id,
        channel: { id: info.channel_id ?? null, name: info.channel ?? null },
        title: info.title ?? '',
        participants: membersOnStage,
        registered: false,
        steps: ['info', 'register', 'fetch', 'local-ingest',
          ...(options.online === false ? [] : ['online-ingest', 'verify', 'publish', 'purge'])],
        verifyProblems: 0,
      },
    }
  }

  // 先登记，再 ingest：ingest 读登记文件决定 participants。
  const registration = registerParticipants(videoId, membersOnStage)
  log.info(
    `已写入 ${registration.previous ? '覆盖' : '新增'}登记：${videoId} → [${membersOnStage.join(', ')}]`
    + `（登记总数 ${registration.total}）`,
  )

  const root = resolve(
    options.root ?? process.env.STREAM_SESSION_ROOT ?? join(APP_ROOT, 'temp', 'youtube-live'),
  )
  const idsDir = join(APP_ROOT, 'temp', 'official')
  mkdirSync(idsDir, { recursive: true })
  const idsFile = join(idsDir, `${videoId}.txt`)
  writeFileSync(idsFile, `${videoId}\n`, 'utf8')

  const steps: string[] = ['info', 'register']

  // fetch 对没有 channelId 的账号要求显式 ID；这里始终用 --ids。
  const fetched = await runFetch({
    dataset: target.id,
    root,
    ids: idsFile,
    noPublish: true,
    cookies: options.cookies,
    cookiesFromBrowser: options.cookiesFromBrowser,
    noCookies: options.anonymous === true,
    dryRun: false,
    log,
  })
  assertStep(
    fetched,
    '抓取素材 / 生成 datapack',
    `bun run ymmt data fetch --dataset ${target.id} --ids ${idsFile} --log-level debug`,
  )
  steps.push('fetch')

  assertStep(
    await runIngest(['--dataset', target.id, '--ids', idsFile]),
    '本地 ingest',
    `bun run ymmt db ingest --dataset ${target.id} --ids ${idsFile} --log-level debug`,
  )
  steps.push('local-ingest')

  let verifyProblems = 0
  const online = options.online !== false
  if (online) {
    const onlineTarget = readOnlineTarget({ config: devkit, cwd: APP_ROOT })
    const restoreEnv = applyOnlineEnv({ config: devkit, target: onlineTarget })
    try {
      log.info(`线上目标：${new URL(onlineTarget.databaseUrl).host} · r2://${onlineTarget.bucket}`)

      assertStep(
        await runIngest(['--dataset', target.id, '--ids', idsFile]),
        '线上 ingest',
        `LOCAL=0 bun run ymmt db ingest --dataset ${target.id} --ids ${idsFile} --log-level debug`,
      )
      steps.push('online-ingest')

      if (options.verify !== false) {
        const verified = await runVerify({ dataset: target.id, idsFile, log })
        verifyProblems = verified.data.problems
        if (verifyProblems > 0)
          log.warn(`定向对账有 ${verifyProblems} 个问题；线上已写入，明细见上面的 db.verify 日志`)
        else
          log.info(`定向对账通过：${verified.data.checked} 场`)
        steps.push('verify')
      }

      assertStep(
        await runPublishData({ dataset: target.id, ids: idsFile, log }),
        '发布索引与 archive',
        `LOCAL=0 bun run ymmt publish data --dataset ${target.id} --ids ${idsFile} --log-level debug`,
      )
      steps.push('publish')

      assertStep(
        await runPurge({ dataset: [target.id], video: [videoId], log }),
        '缓存失效',
        `LOCAL=0 bun run ymmt publish purge --dataset ${target.id} --video ${videoId} --log-level debug`,
      )
      steps.push('purge')
    }
    finally {
      restoreEnv()
    }
  }
  else {
    assertStep(
      await runPublishData({ dataset: target.id, ids: idsFile, noUpload: true, log }),
      '生成本地 manifest / insights',
      `bun run ymmt publish data --dataset ${target.id} --ids ${idsFile} --no-upload --log-level debug`,
    )
    steps.push('publish')
  }

  log.line(
    `已添加：${info.title ?? videoId}`
    + ` → ${target.label}，参与者 ${membersOnStage.join(', ')}`,
  )

  return {
    exitCode: verifyProblems > 0 ? 1 : 0,
    data: {
      videoId,
      dataset: target.id,
      channel: { id: info.channel_id ?? null, name: info.channel ?? null },
      title: info.title ?? '',
      participants: membersOnStage,
      registered: true,
      steps,
      verifyProblems,
    },
  }
}

/** `data official`：手动添加官方账号的场次（bangdream 母频道、第三方账号）。 */
export const dataOfficialSpec: CommandSpec<OfficialAddResult> = {
  id: 'data.official',
  description: '手动添加官方账号的场次：拉元信息 → 登记参与者 → 抓取 → 入库 → 发布',
  details: '用于 bangdream 母频道与第三方官方账号的场次（TV LIVE 出演、商店直播、企划方节目）。\n'
    + '参与者必须显式指定（`all` 或成员 id 列表），因为标题与简介都不可靠。\n'
    + `默认落到聚合账号 ${FALLBACK_OFFICIAL_ID}（kind=official，sync=manual），不并入成员个人场次。\n`
    + '不同账号各建一个 dataset 时用 --dataset 指定；指向成员频道会被拒绝。',
  examples: [
    'bun run ymmt data official "https://www.youtube.com/watch?v=Jih2ArVViRo" --participants arale,nonoka',
    'bun run ymmt data official https://youtu.be/4l7mcDP7-ZY --participants yuno',
    'bun run ymmt data official V2AJBNJGR8E --participants all --dry-run',
    'bun run ymmt data official V2AJBNJGR8E --participants all --no-online',
  ],
  arguments: [
    { name: 'video', description: 'YouTube 链接或 11 位视频 ID', required: true },
  ],
  options: [
    new Option('--participants <ids>', '参与者：all 或逗号分隔的成员 id（可重复）').argParser(
      (value: string, previous: string[] | undefined): string[] => [...(previous ?? []), value],
    ),
    new Option('--dataset <id>', `归属的官方账号，默认 ${FALLBACK_OFFICIAL_ID}`),
    new Option('--root <目录>', '原始会话根目录，默认 $STREAM_SESSION_ROOT 或 ./temp/youtube-live'),
    new Option('--no-online', '只更新本地 pack / 本地库，不写线上 Neon 与 R2'),
    new Option('--no-verify', '跳过线上写入后的定向对账'),
    new Option('--cookies <文件>', 'Netscape cookie jar'),
    new Option('--cookies-from-browser <b>', `导出 cookie 的浏览器，默认 ${DEFAULT_COOKIE_BROWSER}`),
    new Option('--anonymous', '匿名抓取，不读也不导出 cookie'),
  ],
  async run(ctx) {
    const raw = ctx.options.participants
    const participants = raw === undefined ? [] : Array.isArray(raw) ? raw.map(String) : [String(raw)]
    const result = await runOfficialAdd({
      ref: ctx.args[0] ?? '',
      participants,
      dataset: typeof ctx.options.dataset === 'string' ? ctx.options.dataset : undefined,
      root: typeof ctx.options.root === 'string' ? ctx.options.root : undefined,
      online: ctx.options.online !== false,
      verify: ctx.options.verify !== false,
      cookies: typeof ctx.options.cookies === 'string' ? ctx.options.cookies : undefined,
      cookiesFromBrowser: typeof ctx.options.cookiesFromBrowser === 'string'
        ? ctx.options.cookiesFromBrowser
        : undefined,
      anonymous: ctx.flag('anonymous'),
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    return {
      exitCode: result.exitCode,
      data: result.data,
      summary: result.data?.verifyProblems
        ? `已添加，但对账有 ${result.data.verifyProblems} 个问题`
        : '已添加官方的联动场次',
    }
  },
}
