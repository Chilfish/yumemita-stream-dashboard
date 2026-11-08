import type { APIRoute } from 'astro'
import { db } from '@/db/client'
import { getCompareDensityResult } from '@/db/queries/packs'
import { memberOnlyAccess } from '@/lib/member-access'
import { parseCompareIds } from '@/lib/routes'

export const prerender = false

/** 对比页按需补拉：只返回逐分钟弹幕，不还原整份 pack。 */
export const GET: APIRoute = async (context) => {
  const datasetId = context.params.datasetId
  if (!datasetId) {
    return Response.json({ error: '缺少参数' }, { status: 400 })
  }

  const videoIds = parseCompareIds(context.url.searchParams.get('ids'), 8)
  if (videoIds.length === 0) {
    return Response.json(
      { densities: {}, locked: [] },
      { headers: { 'cache-control': 'no-store' } },
    )
  }

  const { unlocked, keyed } = memberOnlyAccess(context.url)
  if (keyed) context.cache.set(false)

  try {
    const { densities, locked } = await getCompareDensityResult(db, datasetId, videoIds, {
      includeMemberOnly: unlocked,
    })

    if (!keyed) {
      context.cache.set({
        maxAge: 3600,
        swr: 86400,
        tags: [`dataset-${datasetId}`, ...Object.keys(densities).map(videoId => `stream-${videoId}`)],
      })
    }

    return Response.json({ densities, locked }, {
      headers: {
        'cache-control': keyed
          ? 'private, no-store'
          : 'public, max-age=3600, stale-while-revalidate=86400',
      },
    })
  }
  catch (error) {
    console.error('[api] densities failed', error)
    return Response.json(
      { error: '数据读取失败' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}
