/**
 * 手动 / 脚本调用 Worker 的内部缓存失效端点。
 *
 *   bun run ymmt publish purge --all
 *   bun run ymmt publish purge --tags group,sitemap,llms
 *   bun run ymmt publish purge --dataset nonoka
 *   bun run ymmt publish purge --dataset nonoka --video W0bKqP-Eyj4
 *   bun run ymmt publish purge --url https://example.com --tags dataset-nonoka
 *
 * 需要 SITE_URL（或 --url）与 PURGE_TOKEN；令牌只存在 Worker secret 与本地环境里。
 *
 * 业务主体在 `runPurge`：其它脚本（日更、同步）直接 import 它，参数就是一个普通对象；
 * `publishPurgeSpec` 只负责把 `ctx` 翻译成那份参数。
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Option } from 'commander'
import { ALL_CACHE_TAGS, CACHE_TAGS, datasetTag, streamTag } from '@/lib/cache-tags.ts'
import type { CommandSpec } from '@scripts/lib/cli/runtime.ts'
import { CliError } from '@scripts/lib/cli/exit.ts'
import type { Logger } from '@scripts/lib/cli/logger.ts'
import { purgeCache } from '@scripts/lib/purge.ts'

const APP_ROOT = resolve(import.meta.dir, '../../..')

/** 默认日志器：不注入 `log` 时整条命令静默，只返回结果。 */
const silentLog: Logger = {
  name: 'publish.purge',
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  line: () => {},
  output: () => {},
  child: () => silentLog,
}

/** `runPurge` 的入参：CLI 里每个 flag 的 camelCase 镜像。 */
export interface PurgeOptions {
  /** `--url`：覆盖 SITE_URL。 */
  url?: string
  /** `--token`：覆盖 PURGE_TOKEN。 */
  token?: string
  /** `--tags`：追加 tag（可重复，每项可用逗号分隔多个）。 */
  tags?: string[]
  /** `--dataset`：追加 dataset-<id>、group、gallery、schedule、sitemap、llms。 */
  dataset?: string[]
  /** `--video`：追加 stream-<id>。 */
  video?: string[]
  /** `--group`：追加 group、gallery、schedule、sitemap、llms。 */
  group?: boolean
  /** `--all`：刷新所有页面。 */
  all?: boolean
  /** `--dry-run`：只算 tag 并返回，不发请求。 */
  dryRun?: boolean
  /** 进度日志；默认静默。 */
  log?: Logger
}

export interface PurgeResultEnvelope {
  exitCode: number
  data?: unknown
}

/**
 * tag 计算：`--tags` → `--dataset` → `--video` → `--group` → `--all` 依次累加，
 * 语义与顺序都保持原样（去重由 Set 负责，输出按添加顺序）。
 */
export function computePurgeTags(options: PurgeOptions = {}): string[] {
  const tags = new Set<string>()
  for (const value of options.tags ?? []) {
    for (const tag of value.split(','))
      if (tag.trim()) tags.add(tag.trim())
  }
  for (const datasetId of options.dataset ?? []) {
    tags.add(datasetTag(datasetId))
    tags.add(CACHE_TAGS.group)
    tags.add(CACHE_TAGS.gallery)
    tags.add(CACHE_TAGS.schedule)
    tags.add(CACHE_TAGS.sitemap)
    tags.add(CACHE_TAGS.llms)
  }
  for (const videoId of options.video ?? [])
    tags.add(streamTag(videoId))
  if (options.group) {
    tags.add(CACHE_TAGS.group)
    tags.add(CACHE_TAGS.gallery)
    tags.add(CACHE_TAGS.schedule)
    tags.add(CACHE_TAGS.sitemap)
    tags.add(CACHE_TAGS.llms)
  }
  if (options.all) {
    for (const tag of ALL_CACHE_TAGS)
      tags.add(tag)
    const config = JSON.parse(readFileSync(join(APP_ROOT, 'data-sources.json'), 'utf8')) as {
      datasets?: { id: string }[]
    }
    for (const source of config.datasets ?? [])
      tags.add(datasetTag(source.id))
  }
  return [...tags]
}

export async function runPurge(options: PurgeOptions = {}): Promise<PurgeResultEnvelope> {
  const log = options.log ?? silentLog
  const tags = computePurgeTags(options)

  if (tags.length === 0) {
    throw new CliError('没有 tag；用 --all / --tags / --dataset / --video 指定', {
      code: 'NO_PURGE_TAGS',
      hint: '示例：bun run ymmt publish purge --all',
    })
  }

  if (options.dryRun === true) {
    log.info(`dry-run：不发请求，将失效 ${tags.length} 个 tag：${tags.join(', ')}`)
    return { exitCode: 0, data: { dryRun: true, tags, success: true } }
  }

  const result = await purgeCache({
    siteUrl: options.url,
    token: options.token,
    tags,
  })

  if (result.skipped) {
    log.info(`跳过：${result.reason}`)
    return { exitCode: 0, data: { skipped: true, reason: result.reason ?? null, tags, success: true } }
  }
  log.info(`${result.success ? '成功' : '失败'}：${tags.join(', ')}`)
  if (result.status) log.info(`HTTP ${result.status}`)
  if (!result.success) {
    log.error(result.reason ?? `HTTP ${result.status ?? '?'}`)
    return {
      exitCode: 1,
      data: { success: false, reason: result.reason ?? null, status: result.status ?? null, tags },
    }
  }

  return { exitCode: 0, data: { success: true, status: result.status ?? null, tags } }
}

/** `--tags` / `--dataset` / `--video` 都可能重复出现；commander 收集成数组。 */
function toStringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) return value.map(item => String(item))
  return [String(value)]
}

export const publishPurgeSpec: CommandSpec = {
  id: 'publish.purge',
  description: '缓存失效：按 tag 调 Worker 内部 purge 端点',
  details: 'tag 由 --tags / --dataset / --video / --group / --all 累加得到；\n'
    + '需要 SITE_URL（或 --url）与 PURGE_TOKEN；LOCAL=1 时直接跳过、不视为失败。',
  examples: [
    'bun run ymmt publish purge --all',
    'bun run ymmt publish purge --dataset nonoka',
    'bun run ymmt publish purge --dataset nonoka --video W0bKqP-Eyj4',
    'bun run ymmt publish purge --tags group,sitemap,llms',
  ],
  options: [
    new Option('--tags <a,b>', '追加 tag（可重复）').argParser((value: string, previous: string[] = []) => [...previous, value]),
    new Option('--dataset <id>', '追加 dataset-<id>、group、gallery、schedule、sitemap、llms（可重复）').argParser((value: string, previous: string[] = []) => [...previous, value]),
    new Option('--video <id>', '追加 stream-<id>（可重复）').argParser((value: string, previous: string[] = []) => [...previous, value]),
    new Option('--group', '追加 group、gallery、schedule、sitemap、llms'),
    new Option('--all', '刷新所有页面（group / gallery / datasets / streams / transcripts / sitemap / llms）'),
    new Option('--url <url>', '覆盖 SITE_URL'),
    new Option('--token <token>', '覆盖 PURGE_TOKEN'),
  ],
  async run(ctx) {
    const result = await runPurge({
      url: typeof ctx.options.url === 'string' ? ctx.options.url : undefined,
      token: typeof ctx.options.token === 'string' ? ctx.options.token : undefined,
      tags: toStringList(ctx.options.tags),
      dataset: toStringList(ctx.options.dataset),
      video: toStringList(ctx.options.video),
      group: ctx.flag('group'),
      all: ctx.flag('all'),
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    const data = result.data as { skipped?: boolean, success?: boolean, reason?: string, dryRun?: boolean }
    return {
      exitCode: result.exitCode,
      data: result.data,
      summary: data.skipped
        ? `缓存失效跳过：${data.reason ?? ''}`
        : data.success
          ? '缓存失效完成'
          : '缓存失效失败',
    }
  },
}
