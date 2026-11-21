import type { APIRoute } from 'astro'
import { runBatch } from '@/db/batch'
import { db } from '@/db/client'
import { mapDataset, selectDatasetsQuery, type DatasetQueryRow } from '@/db/queries/datasets'
import { buildAllStreamHeadsQuery } from '@/db/queries/streams'
import { renderLlmsTxt, type LlmsStreamInput } from '@/lib/agent-llms'
import { DEFAULT_SITE_URL } from '@/lib/site-defaults'

export const prerender = false

export const GET: APIRoute = async (context) => {
  context.cache.set({ maxAge: 3600, swr: 86400, tags: ['llms'] })
  const origin = (context.site?.origin ?? DEFAULT_SITE_URL).replace(/\/+$/, '')

  // 全部成员的最新场次标题一次取回，再按成员分组。
  const [datasetRows, streamRows] = await runBatch<[
    DatasetQueryRow[],
    Awaited<ReturnType<typeof buildAllStreamHeadsQuery>>,
  ]>(db, [
    selectDatasetsQuery(db, undefined),
    buildAllStreamHeadsQuery(db),
  ])

  const streams: LlmsStreamInput[] = streamRows.map(row => ({
    datasetId: row.datasetId,
    videoId: row.videoId,
    title: row.title,
    date: row.date ?? '',
    availability: row.availability,
  }))

  const body = renderLlmsTxt({
    origin,
    members: datasetRows.map(mapDataset).map(dataset => ({
      id: dataset.id,
      label: dataset.label,
      kind: dataset.kind,
      streamCount: dataset.streamCount,
    })),
    streams,
  })

  return new Response(body, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      // 与 `.md` 端点保持一致：显式声明缓存，不依赖 provider 的派生头。
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
      'content-signal': 'ai-train=no, search=yes, ai-input=yes',
    },
  })
}
