import type { APIRoute } from 'astro'
import { db } from '@/db/client'
import { getDatasets } from '@/db/queries/datasets'
import { listStreams } from '@/db/queries/streams'
import { buildSitemap } from '@/lib/seo'
import { DEFAULT_SITE_URL } from '@/lib/site-defaults'
import { isMemberOnly } from '@/lib/visibility'

export const prerender = false

export const GET: APIRoute = async (context) => {
  context.cache.set({ maxAge: 300, swr: 600, tags: ['sitemap'] })
  const origin = context.site?.origin ?? DEFAULT_SITE_URL
  const datasets = await getDatasets(db)
  const entries = await Promise.all(
    datasets.map(async dataset => {
      const list = await listStreams(db, dataset.id, { limit: 2000 })
      return {
        id: dataset.id,
        updatedAt: dataset.generatedAt,
        // 会限单场是 noindex，不进 sitemap。
        streams: list.streams
          .filter(stream => !isMemberOnly(stream.availability))
          .map(stream => ({
            videoId: stream.videoId,
            startedAt: stream.startedAt,
          })),
      }
    }),
  )

  return new Response(buildSitemap(origin, '', entries), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
    },
  })
}
