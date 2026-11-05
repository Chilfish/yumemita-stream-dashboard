import type { APIRoute } from 'astro'
import { runBatch } from '@/db/batch'
import { db } from '@/db/client'
import { mapDataset, selectDatasetsQuery, type DatasetQueryRow } from '@/db/queries/datasets'
import { toIso } from '@/db/queries/shared'
import { buildAllStreamRefsQuery } from '@/db/queries/streams'
import { buildSitemap } from '@/lib/seo'
import { DEFAULT_SITE_URL } from '@/lib/site-defaults'
import { isMemberOnly } from '@/lib/visibility'

export const prerender = false

export const GET: APIRoute = async (context) => {
  context.cache.set({ maxAge: 3600, swr: 86400, tags: ['sitemap'] })
  const origin = context.site?.origin ?? DEFAULT_SITE_URL

  // 全部成员的定位信息一次取回；两条查询放进同一个 batch。
  const [datasetRows, streamRows] = await runBatch<[
    DatasetQueryRow[],
    Awaited<ReturnType<typeof buildAllStreamRefsQuery>>,
  ]>(db, [
    selectDatasetsQuery(db, undefined),
    buildAllStreamRefsQuery(db),
  ])

  const byDataset = new Map<string, { videoId: string, startedAt: string | null, availability: string | null }[]>()
  for (const row of streamRows) {
    const list = byDataset.get(row.datasetId)
    const item = {
      videoId: row.videoId,
      startedAt: toIso(row.startedAt),
      availability: row.availability,
    }
    if (list) list.push(item)
    else byDataset.set(row.datasetId, [item])
  }

  const entries = datasetRows.map(mapDataset).map(dataset => ({
    id: dataset.id,
    updatedAt: dataset.generatedAt,
    // 会限单场是 noindex，不进 sitemap。
    streams: (byDataset.get(dataset.id) ?? [])
      .filter(stream => !isMemberOnly(stream.availability))
      .map(stream => ({
        videoId: stream.videoId,
        startedAt: stream.startedAt,
      })),
  }))

  return new Response(buildSitemap(origin, '', entries), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
    },
  })
}
