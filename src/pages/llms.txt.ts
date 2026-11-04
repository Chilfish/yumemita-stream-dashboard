import type { APIRoute } from 'astro'
import { db } from '@/db/client'
import { getDatasets } from '@/db/queries/datasets'
import { listStreams } from '@/db/queries/streams'
import { DEFAULT_SITE_URL } from '@/lib/site-defaults'

export const prerender = false

export const GET: APIRoute = async (context) => {
  context.cache.set({ maxAge: 300, swr: 600, tags: ['llms'] })
  const origin = context.site?.origin ?? DEFAULT_SITE_URL
  const datasets = await getDatasets(db)

  const lines: string[] = [
    '# ゆめみた 配信数据台',
    '',
    '> 夢限大みゅーたいぷ 成员直播数据的可视化数据台。每个单场页都有对应的 Markdown 视图，字段含概览、时间轴、弹幕、付费、评论与逐字稿。',
    '',
    '## 成员',
    '',
  ]

  for (const dataset of datasets) {
    lines.push(`- [${dataset.label}](${origin}/${dataset.id}) · ${dataset.streamCount} 场 · Markdown 索引：${origin}/${dataset.id}/streams`)
  }

  lines.push('', '## 最近场次', '')
  const recent = await Promise.all(
    datasets.map(async dataset => {
      const list = await listStreams(db, dataset.id, { limit: 5 })
      return list.streams.map(stream => ({ dataset, stream }))
    }),
  )

  for (const { dataset, stream } of recent.flat().slice(0, 20)) {
    lines.push(
      `- ${dataset.label} · ${stream.date} · ${stream.title} — ${origin}/${dataset.id}/stream/${stream.videoId}.md`,
    )
  }

  lines.push(
    '',
    '## 约定',
    '',
    '- 单场 Markdown：`/<datasetId>/stream/<videoId>.md`',
    '- HTML 单场页在 `<head>` 里用 `rel="alternate" type="text/markdown"` 指向 Markdown。',
    '- 时间一律 JST；金额按币种分列，不做汇率换算。',
    '- Markdown 视图用 `X-Robots-Tag: noindex`，不进 sitemap。',
    '',
  )

  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
  })
}
