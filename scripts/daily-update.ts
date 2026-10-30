#!/usr/bin/env bun
/**
 * 每日增量更新：频道列表 → 只处理有变化的场次 → 补封面 → 定点发布。
 *
 *   bun scripts/daily-update.ts                    # 正常增量（本地用 Firefox cookie）
 *   bun scripts/daily-update.ts --force            # 额外重抓最近 24 小时
 *   bun scripts/daily-update.ts --dataset nonoka   # 只跑一位成员
 *   bun scripts/daily-update.ts --dry-run          # 只列出这次会动哪些场次
 *   bun scripts/daily-update.ts --no-publish       # 只抓本地，不传对象存储
 *
 * 设计要点：
 *   - 先拉频道 `/streams`（flat-playlist，不需要 cookie），和**远端 manifest** 求差集；
 *     没有新场次且没有待补数据的成员直接跳过，不恢复、不发布。
 *   - 有变化才对该成员 `--restore`（补齐远端 pack，保证 insights 精确）并定点发布，
 *     其余成员不下载、不上传。
 *   - `--force` 重抓最近 24 小时；平时也会重试近期缺 VSTATS / 缺弹幕的场次，
 *     避免回放或 VSTATS 页面还没生成时被永久判死。
 *   - 发布时间点在最后：抓取失败只影响该成员，是否发布由 publish 的完整性校验兜底。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createObjectStore, manifestKey, readCredentials, remoteBase } from './lib/object-storage.ts'
import { planDataset, type ChannelEntry, type PlanStream } from './lib/update-plan.ts'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = join(APP_ROOT, 'data-sources.json')
const FETCH_SCRIPT = join(APP_ROOT, 'scripts', 'fetch-streams.ts')
const THUMB_SCRIPT = join(APP_ROOT, 'scripts', 'fetch-thumbnails.ts')
const PUBLISH_SCRIPT = join(APP_ROOT, 'scripts', 'publish-data.ts')

const FORCE_RECENT_HOURS = 24

interface DatasetSource {
  id: string
  label: string
  channelId?: string
  manifest: string
  datapackDir: string
}

interface ManifestStream {
  videoId?: string
  title?: string | null
  durationSec?: number | null
  startedAt?: string | null
  endedAt?: string | null
  availability?: string | null
  vstatsViews?: number | null
  avgConcurrent?: number | null
  chatTotal?: number | null
}

interface ManifestFile {
  count?: number
  streams?: ManifestStream[]
}

interface LoadedManifest {
  streams: PlanStream[]
  /** 远端/本地清单的 generatedAt，用来判断本地是否有未发布的改动。 */
  generatedAt: string | null
  from: 'remote' | 'vault' | 'local' | 'empty'
}

const OPTIONS = {
  dataset: { type: 'string' },
  root: { type: 'string' },
  'state-dir': { type: 'string' },
  concurrency: { type: 'string', default: '3' },
  cookies: { type: 'string' },
  'cookies-from-browser': { type: 'string', default: 'firefox' },
  force: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  'no-publish': { type: 'boolean' },
  bootstrap: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const

const USAGE = `用法：bun scripts/daily-update.ts [选项]

按频道 /streams 列表和远端 manifest 求差集，只抓有变化的场次并定点发布。
没有任何新场次的成员不会恢复 datapack，也不会发布。

选项：
  --dataset <id>              只处理一个 dataset；默认全部
  --root <目录>               原始会话目录（默认 $STREAM_SESSION_ROOT 或 ./temp/youtube-live）
  --state-dir <目录>          进度/频道缓存（默认 <root>/.fetch-state）
  --concurrency <n>           抓取并发，默认 3
  --cookies <文件>            Netscape cookie jar；CI 用这个
  --cookies-from-browser <b>  本地默认 firefox
  --force                     额外重抓最近 ${FORCE_RECENT_HOURS} 小时结束的场次
  --dry-run                   只列候选，不抓取、不发布
  --no-publish                只写本地，不上传对象存储
  --bootstrap                 远端清单读不到时也允许按全量新场次处理
  -h, --help                  显示本帮助

发布需要 R2_* 凭据；只抓取不需要。`

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function runCapture(command: string, args: string[], env?: Record<string, string>): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : process.env,
    })
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
      const stderr = Buffer.concat(err).toString('utf8').trim().split('\n').slice(-3).join(' | ')
      rejectPromise(new Error(`${command} exit ${code}${stderr ? `：${stderr}` : ''}`))
    })
  })
}

function runScript(script: string, args: string[]): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit' })
    child.on('error', rejectPromise)
    child.on('close', code => resolvePromise(code ?? 1))
  })
}

/** 远端公开地址优先，其次直接读桶，最后回退本地暂存区。 */
async function loadManifest(source: DatasetSource): Promise<LoadedManifest> {
  const base = remoteBase()
  if (base) {
    try {
      const response = await fetch(`${base}/${source.id}/manifest.json?t=${Date.now()}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      })
      if (response.ok) {
        const manifest = (await response.json()) as ManifestFile
        return { streams: toPlanStreams(manifest), generatedAt: manifest.generatedAt ?? null, from: 'remote' }
      }
    }
    catch {
      // 公开地址不可达时继续试桶凭据。
    }
  }

  const credentials = readCredentials()
  if (credentials) {
    try {
      const text = await createObjectStore(credentials).get(manifestKey(source.id))
      if (text) {
        const manifest = JSON.parse(text) as ManifestFile
        return { streams: toPlanStreams(manifest), generatedAt: manifest.generatedAt ?? null, from: 'vault' }
      }
    }
    catch {
      // 读桶失败不阻塞本地回退。
    }
  }

  const localPath = resolve(APP_ROOT, source.manifest)
  if (existsSync(localPath)) {
    try {
      const manifest = readJson<ManifestFile>(localPath)
      return { streams: toPlanStreams(manifest), generatedAt: manifest.generatedAt ?? null, from: 'local' }
    }
    catch {
      // 本地文件损坏时按空清单处理，交给 --bootstrap 或下一次恢复。
    }
  }
  return { streams: [], generatedAt: null, from: 'empty' }
}

function toPlanStreams(manifest: ManifestFile): PlanStream[] {
  return (manifest.streams ?? [])
    .filter((stream): stream is ManifestStream & { videoId: string } => Boolean(stream.videoId))
    .map(stream => ({
      videoId: stream.videoId,
      title: stream.title ?? null,
      durationSec: stream.durationSec ?? null,
      startedAt: stream.startedAt ?? null,
      endedAt: stream.endedAt ?? null,
      availability: stream.availability ?? null,
      vstatsViews: stream.vstatsViews ?? null,
      avgConcurrent: stream.avgConcurrent ?? null,
      chatTotal: stream.chatTotal ?? null,
    }))
}

interface ChannelList {
  entries: ChannelEntry[]
  /** 频道列表没拿到（网络 / bot 检查 / 没缓存）：本次可能漏掉新场次，要记失败。 */
  failed: boolean
}

/**
 * 频道 `/streams` 列表。用 `-J` 而不是 `--print`：标题里可能有制表符/换行，
 * 按行切分会错位；同时强制 UTF-8，避免 Windows 控制台编码把日文标题弄坏。
 */
async function readChannelEntries(source: DatasetSource, stateDir: string): Promise<ChannelList> {
  const cachePath = join(stateDir, `channel-${source.id}.json`)
  if (!source.channelId) {
    console.warn(`[update] ${source.id} 缺少 channelId，跳过频道列表`)
    return { entries: existsSync(cachePath) ? readChannelCache(cachePath) : [], failed: true }
  }

  try {
    const raw = await runCapture('yt-dlp', [
      '--flat-playlist',
      '--no-warnings',
      '--socket-timeout',
      '30',
      '--retries',
      '3',
      '-J',
      `https://www.youtube.com/channel/${source.channelId}/streams`,
    ], { PYTHONIOENCODING: 'utf-8' })
    const playlist = JSON.parse(raw) as {
      entries?: { id?: unknown, title?: unknown, duration?: unknown, live_status?: unknown }[]
    }
    const entries: ChannelEntry[] = []
    for (const entry of playlist.entries ?? []) {
      if (typeof entry?.id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(entry.id))
        continue
      entries.push({
        id: entry.id,
        title: typeof entry.title === 'string' ? entry.title : null,
        durationSec: typeof entry.duration === 'number' ? entry.duration : null,
        liveStatus: typeof entry.live_status === 'string' ? entry.live_status : null,
      })
    }
    if (entries.length > 0) {
      writeFileSync(cachePath, `${JSON.stringify({ updatedAt: new Date().toISOString(), entries })}\n`, 'utf8')
      return { entries, failed: false }
    }
    console.warn(`[update] ${source.id} 频道列表为空`)
  }
  catch (error) {
    console.warn(`[update] ${source.id} 频道列表抓取失败：${describe(error)}`)
  }

  if (existsSync(cachePath)) {
    const cached = readChannelCache(cachePath)
    console.warn(`[update] ${source.id} 使用频道列表缓存（${cached.length} 条），本次可能漏掉新场次`)
    return { entries: cached, failed: true }
  }
  console.warn(`[update] ${source.id} 没有频道列表缓存，本次只能处理待补数据的场次`)
  return { entries: [], failed: true }
}

function readChannelCache(path: string): ChannelEntry[] {
  try {
    const cache = readJson<{ entries?: ChannelEntry[] }>(path)
    return (cache.entries ?? []).filter(entry => Boolean(entry?.id))
  }
  catch {
    return []
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: OPTIONS, args: process.argv.slice(2), allowPositionals: false })
  if (values.help) {
    console.log(USAGE)
    return
  }

  const sources = readJson<{ datasets?: DatasetSource[] }>(CONFIG_PATH).datasets ?? []
  const selected = values.dataset ? sources.filter(item => item.id === values.dataset) : sources
  if (selected.length === 0) {
    console.error(`[update] 找不到 dataset：${values.dataset ?? '(data-sources.json 为空)'}`)
    console.error(`[update] 可用：${sources.map(item => item.id).join(', ') || '(空)'}`)
    process.exit(1)
  }

  const root = resolve(values.root ?? process.env.STREAM_SESSION_ROOT ?? join(APP_ROOT, 'temp', 'youtube-live'))
  const dataRoot = join(APP_ROOT, 'data')
  if (root === dataRoot || root.startsWith(`${dataRoot}${sep}`)) {
    console.error('[update] --root 是原始素材目录，不能指向 data/')
    process.exit(1)
  }
  const stateDir = resolve(values['state-dir'] ?? join(root, '.fetch-state'))
  mkdirSync(root, { recursive: true })
  mkdirSync(stateDir, { recursive: true })
  // 安静日不会走到 publish，但 CI 的 data/ 缓存需要一个真实存在的目录。
  mkdirSync(dataRoot, { recursive: true })

  const concurrency = Number(values.concurrency)
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    console.error('[update] --concurrency 需要是 >= 1 的整数')
    process.exit(1)
  }
  const cookieArgs = values.cookies
    ? ['--cookies', resolve(values.cookies)]
    : ['--cookies-from-browser', values['cookies-from-browser'] ?? 'firefox']
  const dryRun = Boolean(values['dry-run'])
  const noPublish = Boolean(values['no-publish'])

  let failures = 0
  let newTotal = 0
  let forcedTotal = 0
  let published = 0

  for (const source of selected) {
    console.log(`\n[update] === ${source.label} (${source.id}) ===`)
    const manifest = await loadManifest(source)
    const knownIds = manifest.streams.map(stream => stream.videoId)
    console.log(`[update] 清单：${knownIds.length} 场（${manifest.from}）`)

    const channelList = await readChannelEntries(source, stateDir)
    const channel = channelList.entries
    if (channel.length === 0 && knownIds.length === 0) {
      console.warn(`[update] ${source.id} 既没有频道列表也没有清单，跳过`)
      failures += 1
      continue
    }
    if (manifest.from === 'empty' && channel.length > 20 && !values.bootstrap) {
      console.error(`[update] ${source.id} 读不到已发布清单，但频道有 ${channel.length} 条；`)
      console.error('[update] 拒绝把整个频道当成新场次。确认要首次建档时加 --bootstrap。')
      failures += 1
      continue
    }

    const plan = planDataset({
      channel,
      knownIds,
      streams: manifest.streams,
      forceRecentHours: values.force ? FORCE_RECENT_HOURS : 0,
    })

    console.log(`[update] 计划：新场次 ${plan.newIds.length}，重抓 ${plan.forceIds.length}，暂缓 ${plan.deferredIds.length}`)
    if (plan.newIds.length > 0)
      console.log(`[update]   新：${plan.newIds.slice(0, 10).join(', ')}${plan.newIds.length > 10 ? ` 等 ${plan.newIds.length} 场` : ''}`)
    if (plan.forceIds.length > 0) {
      const detail = plan.forceIds.slice(0, 10).map(id => `${id}(${plan.reasons.get(id) ?? '重抓'})`).join(', ')
      console.log(`[update]   重抓：${detail}${plan.forceIds.length > 10 ? ` 等 ${plan.forceIds.length} 场` : ''}`)
    }

    // 上次抓取成功但发布失败（或本地用了 --no-publish）时，清单会比远端新；
    // 这种日子没有新场次也要补一次发布，否则改动会一直卡在本地。
    const localManifestPath = resolve(APP_ROOT, source.manifest)
    let localGeneratedAt: string | null = null
    if (existsSync(localManifestPath)) {
      try {
        localGeneratedAt = readJson<ManifestFile>(localManifestPath).generatedAt ?? null
      }
      catch {
        // 本地清单损坏时交给下面的抓取 / 发布流程。
      }
    }
    const localAhead = localGeneratedAt != null && manifest.generatedAt != null
      && Date.parse(localGeneratedAt) > Date.parse(manifest.generatedAt)
    if (localAhead)
      console.log('[update] 本地清单比远端新，本次补发布')

    const hasFetchWork = plan.newIds.length > 0 || plan.forceIds.length > 0
    if (!hasFetchWork && !localAhead) {
      if (channelList.failed) {
        console.warn(`[update] ${source.id} 没有可处理的变化，但频道列表不可用；记一次失败`)
        failures += 1
      }
      else {
        console.log(`[update] ${source.id} 没有变化，跳过`)
      }
      continue
    }
    if (dryRun) {
      console.log(`[update] ${source.id} dry-run，不抓取也不发布`)
      continue
    }

    newTotal += plan.newIds.length
    forcedTotal += plan.forceIds.length

    // 频道列表失败时本次可能漏掉新场次；继续处理待补数据的场次，但结果记为失败。
    let datasetFailed = channelList.failed

    // 正常增量：只把这次判定要抓的场次交给 fetch-streams，
    // 未来场/摘要不会被重新拉一遍元信息。
    if (plan.newIds.length > 0) {
      const idsFile = join(stateDir, `daily-ids-${source.id}.txt`)
      writeFileSync(idsFile, `${plan.newIds.join('\n')}\n`, 'utf8')
      console.log(`[update] ${source.id} 抓取新场次…`)
      const code = await runScript(FETCH_SCRIPT, [
        '--dataset', source.id,
        '--root', root,
        '--ids', idsFile,
        '--restore',
        '--no-publish',
        '--concurrency', String(concurrency),
        ...cookieArgs,
      ])
      if (code !== 0) {
        datasetFailed = true
        console.warn(`[update] ${source.id} 新场次抓取有失败项（exit ${code}）`)
      }
    }

    // 定点重抓：最近 24 小时 + 缺 VSTATS / 缺弹幕。
    if (plan.forceIds.length > 0) {
      console.log(`[update] ${source.id} 重抓 ${plan.forceIds.length} 场…`)
      const code = await runScript(FETCH_SCRIPT, [
        '--dataset', source.id,
        '--root', root,
        '--force', plan.forceIds.join(','),
        '--restore',
        '--no-publish',
        '--concurrency', String(concurrency),
        ...cookieArgs,
      ])
      if (code !== 0) {
        datasetFailed = true
        console.warn(`[update] ${source.id} 重抓有失败项（exit ${code}）`)
      }
    }

    if (noPublish) {
      console.log(`[update] ${source.id} --no-publish，跳过封面与发布`)
      continue
    }

    // 只补发布时没有新场次，不需要碰封面（空 --ids 不能当成“全部”）。
    const thumbIds = unique([...plan.newIds, ...plan.forceIds])
    if (thumbIds.length > 0) {
      const thumbFile = join(stateDir, `daily-thumbs-${source.id}.txt`)
      writeFileSync(thumbFile, `${thumbIds.join('\n')}\n`, 'utf8')
      const thumbCode = await runScript(THUMB_SCRIPT, [
        '--dataset', source.id,
        '--ids', thumbFile,
      ])
      if (thumbCode !== 0) {
        datasetFailed = true
        console.warn(`[update] ${source.id} 封面补抓有失败项（exit ${thumbCode}）`)
      }
    }

    console.log(`[update] ${source.id} 发布…`)
    const publishCode = await runScript(PUBLISH_SCRIPT, ['--dataset', source.id])
    if (publishCode !== 0) {
      datasetFailed = true
      console.warn(`[update] ${source.id} 发布失败（exit ${publishCode}）`)
    }
    else {
      published += 1
    }

    if (datasetFailed)
      failures += 1
  }

  console.log(`\n[update] 完成：新场次 ${newTotal}，重抓 ${forcedTotal}，发布 ${published} 个成员，失败 ${failures} 个`)
  if (failures > 0)
    process.exitCode = 1
}

await main()
