#!/usr/bin/env bun
/**
 * 手动 / 脚本调用 Worker 的内部缓存失效端点。
 *
 *   bun scripts/purge-cache.ts --tags group,sitemap,llms
 *   bun scripts/purge-cache.ts --dataset nonoka
 *   bun scripts/purge-cache.ts --dataset nonoka --video W0bKqP-Eyj4
 *   bun scripts/purge-cache.ts --url https://example.com --tags dataset-nonoka
 *
 * 需要 SITE_URL（或 --url）与 PURGE_TOKEN；令牌只存在 Worker secret 与本地环境里。
 */
import { parseArgs } from 'node:util'
import { loadEnvFiles } from './lib/env.ts'
import { purgeCache } from './lib/purge.ts'

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    token: { type: 'string' },
    tags: { type: 'string', multiple: true },
    dataset: { type: 'string', multiple: true },
    video: { type: 'string', multiple: true },
    group: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: false,
})

const USAGE = `用法：bun scripts/purge-cache.ts [选项]

选项：
  --tags <a,b>       追加 tag（可重复）
  --dataset <id>     追加 dataset-<id>、group、sitemap、llms
  --video <id>       追加 stream-<id>
  --group            追加 group、gallery、sitemap、llms
  --url <url>        覆盖 SITE_URL
  --token <token>    覆盖 PURGE_TOKEN
  -h, --help         显示本帮助`

if (values.help) {
  console.log(USAGE)
  process.exit(0)
}

loadEnvFiles()

const tags = new Set<string>()
for (const value of values.tags ?? []) {
  for (const tag of value.split(','))
    if (tag.trim()) tags.add(tag.trim())
}
for (const datasetId of values.dataset ?? []) {
  tags.add(`dataset-${datasetId}`)
  tags.add('group')
  tags.add('sitemap')
  tags.add('llms')
}
for (const videoId of values.video ?? [])
  tags.add(`stream-${videoId}`)
if (values.group) {
  tags.add('group')
  tags.add('gallery')
  tags.add('sitemap')
  tags.add('llms')
}

if (tags.size === 0) {
  console.error('[purge] 没有 tag；用 --tags / --dataset / --video 指定')
  process.exit(1)
}

const result = await purgeCache({
  siteUrl: values.url,
  token: values.token,
  tags: [...tags],
})

if (result.skipped) {
  console.log(`[purge] 跳过：${result.reason}`)
  process.exit(0)
}
console.log(`[purge] ${result.success ? '成功' : '失败'}：${[...tags].join(', ')}`)
if (result.status) console.log(`[purge] HTTP ${result.status}`)
if (!result.success) {
  if (result.reason) console.error(`[purge] ${result.reason}`)
  process.exit(1)
}
