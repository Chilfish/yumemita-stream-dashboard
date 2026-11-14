#!/usr/bin/env bun
/**
 * 单场重抓并覆盖：给一个 YouTube 链接（或视频 ID），把这一场的完整链路跑完。
 *
 *   bun run ymmt data refetch "https://www.youtube.com/watch?v=1dGnP_rXgW0"
 *   bun run ymmt data refetch 1dGnP_rXgW0 --no-online
 *
 * 顺序：重抓素材 → 重建 datapack → 本地 ingest → 线上 ingest → verify → publish data → purge。
 * 默认同时覆盖本地库与线上（.dev.vars 的 DATABASE_URL_ONLINE + R2）；--no-online 只改本地。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Option } from 'commander'
import type { CommandSpec } from '@scripts/lib/cli/runtime.ts'
import { CliError, UsageError } from '@scripts/lib/cli/exit.ts'
import type { Logger } from '@scripts/lib/cli/logger.ts'
import { applyOnlineEnv, readOnlineTarget } from '@scripts/lib/online-env.ts'
import { parseVideoRef } from '@scripts/lib/video-ref.ts'
import { DEFAULT_COOKIE_BROWSER, resolveCookies, ytdlpCookieArgs } from '@scripts/lib/yt-cookies.ts'
import { runIngest } from '../db/ingest.ts'
import { runVerify } from '../db/verify.ts'
import { runPublishData } from '../publish/data.ts'
import { runPurge } from '../publish/purge.ts'
import { runFetch } from './fetch.ts'

const APP_ROOT = resolve(import.meta.dir, '../../..')
const DATASOURCES_PATH = join(APP_ROOT, 'data-sources.json')

interface DatasetSource {
  id: string
  label: string
  channelId?: string
  manifest: string
  datapackDir: string
}

interface PackStats {
  chatTotal: number
  uniqueAuthors: number
  superchats: number
  comments: number
  hasVstats: boolean
}

function readDatasets(): DatasetSource[] {
  const config = JSON.parse(readFileSync(DATASOURCES_PATH, 'utf8')) as { datasets?: DatasetSource[] }
  return config.datasets ?? []
}

function runYtDlpJson(videoId: string, cookieArgs: string[]): Promise<{ channel_id?: string }> {
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
          resolvePromise(JSON.parse(Buffer.concat(out).toString('utf8')) as { channel_id?: string })
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

interface ResolveOptions {
  dataset?: string
  cookies?: string
  cookiesFromBrowser?: string
  anonymous?: boolean
  log: Logger
}

/** dataset 优先按本地 pack 所在目录推断；没有 pack 时用频道 ID 匹配 data-sources.json。 */
async function resolveDataset(
  videoId: string,
  options: ResolveOptions,
): Promise<DatasetSource> {
  const datasets = readDatasets()
  if (datasets.length === 0)
    throw new CliError('data-sources.json 里没有 datasets', { hint: '补上成员配置后再试' })

  if (options.dataset) {
    const explicit = datasets.find(item => item.id === options.dataset)
    if (!explicit) {
      throw new UsageError(`data-sources.json 里没有 dataset：${options.dataset}`, {
        hint: `可用：${datasets.map(item => item.id).join(', ')}`,
      })
    }
    return explicit
  }

  const local = datasets.find(item =>
    existsSync(join(APP_ROOT, item.datapackDir, `${videoId}.datapack.json`)))
  if (local)
    return local

  options.log.info(`本地没有 ${videoId} 的 pack，用 yt-dlp 元信息匹配成员…`)
  const cookies = await resolveCookies({
    cookies: options.cookies,
    envCookie: process.env.YT_COOKIE,
    browser: options.cookiesFromBrowser ?? DEFAULT_COOKIE_BROWSER,
    disable: options.anonymous === true,
    appRoot: APP_ROOT,
    log: line => options.log.info(`[refetch] ${line}`),
  })
  const info = await runYtDlpJson(
    videoId,
    ytdlpCookieArgs(cookies, { browser: options.cookiesFromBrowser ?? DEFAULT_COOKIE_BROWSER }),
  )
  const match = datasets.find(item => item.channelId === info.channel_id)
  if (!match) {
    throw new CliError(`无法把 ${videoId} 归到任何成员频道`, {
      hint: '确认 data-sources.json 里有对应 channelId，或用 --dataset 显式指定',
      context: { videoId, channelId: info.channel_id ?? null },
    })
  }
  return match
}

function findSession(root: string, videoId: string): string | null {
  if (!existsSync(root))
    return null
  const hit = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.endsWith(`_${videoId}`))
    .sort((a, b) => a.name.localeCompare(b.name))[0]
  return hit ? join(root, hit.name) : null
}

function readPackStats(datapackDir: string, videoId: string): PackStats | null {
  const path = join(APP_ROOT, datapackDir, `${videoId}.datapack.json`)
  if (!existsSync(path))
    return null
  const pack = JSON.parse(readFileSync(path, 'utf8')) as {
    chat?: { total?: number, uniqueAuthors?: number, paid?: { superchats?: unknown[] } }
    comments?: { total?: number } | null
    vstats?: unknown
  }
  return {
    chatTotal: pack.chat?.total ?? 0,
    uniqueAuthors: pack.chat?.uniqueAuthors ?? 0,
    superchats: pack.chat?.paid?.superchats?.length ?? 0,
    comments: pack.comments?.total ?? 0,
    hasVstats: pack.vstats != null,
  }
}

export interface RefetchOptions {
  ref: string
  dataset?: string
  root?: string
  /** 默认 true；false 时只更新本地 pack / 本地库，不写线上。 */
  online?: boolean
  /** 默认 true；线上写入后做一次定向对账。 */
  verify?: boolean
  cookies?: string
  cookiesFromBrowser?: string
  anonymous?: boolean
  dryRun?: boolean
  log: Logger
}

export interface RefetchResult {
  videoId: string
  dataset: string
  session: string | null
  online: boolean
  steps: string[]
  before: PackStats | null
  after: PackStats | null
  verifyProblems: number
}

function assertStep(result: { exitCode: number }, label: string, hint: string): void {
  if (result.exitCode === 0)
    return
  throw new CliError(`${label} 失败（exit ${result.exitCode}）`, { hint })
}

export async function runRefetch(options: RefetchOptions): Promise<{ exitCode: number, data?: RefetchResult }> {
  const { log } = options
  const videoId = parseVideoRef(options.ref)
  const online = options.online !== false
  const dataset = await resolveDataset(videoId, {
    dataset: options.dataset,
    cookies: options.cookies,
    cookiesFromBrowser: options.cookiesFromBrowser,
    anonymous: options.anonymous,
    log,
  })

  const root = resolve(
    options.root ?? process.env.STREAM_SESSION_ROOT ?? join(APP_ROOT, 'temp', 'youtube-live'),
  )
  const idsDir = join(APP_ROOT, 'temp', 'refetch')
  const idsFile = join(idsDir, `${videoId}.txt`)
  const steps: string[] = []
  const before = readPackStats(dataset.datapackDir, videoId)

  if (options.dryRun) {
    log.info(`dry-run：${dataset.label}（${dataset.id}）/ ${videoId}`)
    log.info(`步骤：fetch → local-ingest${online ? ' → online-ingest → verify → publish → purge' : ' → publish（仅本地）'}`)
    return {
      exitCode: 0,
      data: {
        videoId,
        dataset: dataset.id,
        session: findSession(root, videoId),
        online,
        steps: ['fetch', 'local-ingest', ...(online ? ['online-ingest', 'verify', 'publish', 'purge'] : ['publish'])],
        before,
        after: before,
        verifyProblems: 0,
      },
    }
  }

  // 1. 重抓素材 + 重建 datapack；发布交给后面的步骤，避免 assets-only 刷新不了索引。
  const fetched = await runFetch({
    dataset: dataset.id,
    root,
    force: [videoId],
    noPublish: true,
    cookies: options.cookies,
    cookiesFromBrowser: options.cookiesFromBrowser,
    noCookies: options.anonymous === true,
    dryRun: false,
    log,
  })
  assertStep(fetched, '重抓素材 / 重建 datapack', `bun run ymmt data fetch --dataset ${dataset.id} --force ${videoId} --log-level debug`)
  steps.push('fetch')

  mkdirSync(idsDir, { recursive: true })
  writeFileSync(idsFile, `${videoId}\n`, 'utf8')

  // 2. 本地库。
  assertStep(
    await runIngest(['--dataset', dataset.id, '--ids', idsFile]),
    '本地 ingest',
    `bun run ymmt db ingest --dataset ${dataset.id} --ids ${idsFile} --log-level debug`,
  )
  steps.push('local-ingest')

  let verifyProblems = 0
  if (online) {
    const target = readOnlineTarget(APP_ROOT)
    const restoreEnv = applyOnlineEnv(target.remote)
    try {
      log.info(`线上目标：${new URL(target.databaseUrl).host} · r2://${target.bucket}`)

      assertStep(
        await runIngest(['--dataset', dataset.id, '--ids', idsFile]),
        '线上 ingest',
        `LOCAL=0 bun run ymmt db ingest --dataset ${dataset.id} --ids ${idsFile} --log-level debug`,
      )
      steps.push('online-ingest')

      if (options.verify !== false) {
        const verified = await runVerify({ dataset: dataset.id, idsFile, log })
        verifyProblems = verified.data.problems
        if (verifyProblems > 0)
          log.warn(`定向对账有 ${verifyProblems} 个问题；线上已写入，明细见上面的 db.verify 日志`)
        else
          log.info(`定向对账通过：${verified.data.checked} 场`)
        steps.push('verify')
      }

      assertStep(
        await runPublishData({ dataset: dataset.id, ids: idsFile, log }),
        '发布索引与 archive',
        `LOCAL=0 bun run ymmt publish data --dataset ${dataset.id} --ids ${idsFile} --log-level debug`,
      )
      steps.push('publish')

      assertStep(
        await runPurge({ dataset: [dataset.id], video: [videoId], log }),
        '缓存失效',
        `LOCAL=0 bun run ymmt publish purge --dataset ${dataset.id} --video ${videoId} --log-level debug`,
      )
      steps.push('purge')
    }
    finally {
      restoreEnv()
    }
  }
  else {
    // 只生成本地 manifest / insights，不碰对象存储。
    assertStep(
      await runPublishData({ dataset: dataset.id, ids: idsFile, noUpload: true, log }),
      '生成本地 manifest / insights',
      `bun run ymmt publish data --dataset ${dataset.id} --ids ${idsFile} --no-upload --log-level debug`,
    )
    steps.push('publish')
  }

  const after = readPackStats(dataset.datapackDir, videoId)
  const session = findSession(root, videoId)
  log.line(
    `重抓完成：${dataset.label} / ${videoId}`
    + ` 弹幕 ${before?.chatTotal ?? 0} → ${after?.chatTotal ?? 0} 条，`
    + `作者 ${after?.uniqueAuthors ?? 0}，SC ${after?.superchats ?? 0}，评论 ${after?.comments ?? 0}`
    + `${after?.hasVstats ? '' : '，VSTATS 未收录'}`,
  )

  return {
    exitCode: verifyProblems > 0 ? 1 : 0,
    data: { videoId, dataset: dataset.id, session, online, steps, before, after, verifyProblems },
  }
}

export const dataRefetchSpec: CommandSpec<RefetchResult> = {
  id: 'data.refetch',
  description: '单场重抓并覆盖：给链接或 ID，重抓素材并同步本地库 / 线上库与 R2 索引',
  details: '解析 YouTube 链接或 11 位视频 ID，按本地 pack 或频道 ID 找到成员，'
    + '然后跑完整链路：重抓素材 → 重建 datapack → 本地 ingest → 线上 ingest → verify → publish → purge。\n'
    + '默认同时覆盖本地与线上（.dev.vars 的 DATABASE_URL_ONLINE / R2_*）；--no-online 只改本地。',
  examples: [
    'bun run ymmt data refetch "https://www.youtube.com/watch?v=1dGnP_rXgW0"',
    'bun run ymmt data refetch 1dGnP_rXgW0',
    'bun run ymmt data refetch https://youtu.be/1dGnP_rXgW0 --no-online',
    'bun run ymmt data refetch 1dGnP_rXgW0 --dataset nonoka --dry-run',
  ],
  arguments: [
    { name: 'video', description: 'YouTube 链接或 11 位视频 ID', required: true },
  ],
  options: [
    new Option('--dataset <id>', '跳过推断，直接指定 dataset'),
    new Option('--root <目录>', '原始会话根目录，默认 $STREAM_SESSION_ROOT 或 ./temp/youtube-live'),
    new Option('--no-online', '只更新本地 pack / 本地库，不写线上 Neon 与 R2 索引'),
    new Option('--no-verify', '跳过线上写入后的定向对账'),
    new Option('--cookies <文件>', 'Netscape cookie jar'),
    new Option('--cookies-from-browser <b>', `导出 cookie 的浏览器，默认 ${DEFAULT_COOKIE_BROWSER}`),
    new Option('--anonymous', '匿名抓取，不读也不导出 cookie'),
  ],
  async run(ctx) {
    const result = await runRefetch({
      ref: ctx.args[0] ?? '',
      dataset: typeof ctx.options.dataset === 'string' ? ctx.options.dataset : undefined,
      root: typeof ctx.options.root === 'string' ? ctx.options.root : undefined,
      online: ctx.options.online !== false,
      verify: ctx.options.verify !== false,
      cookies: typeof ctx.options.cookies === 'string' ? ctx.options.cookies : undefined,
      cookiesFromBrowser: typeof ctx.options.cookiesFromBrowser === 'string' ? ctx.options.cookiesFromBrowser : undefined,
      anonymous: ctx.flag('anonymous'),
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    return {
      exitCode: result.exitCode,
      data: result.data,
      summary: result.data?.verifyProblems
        ? `重抓完成，但对账有 ${result.data.verifyProblems} 个问题`
        : '重抓并覆盖完成',
    }
  },
}
