import type { APIRoute } from 'astro'
import { db } from '@/db/client'
import { getStreamPack } from '@/db/queries/packs'

export const prerender = false

export const GET: APIRoute = async (context) => {
  const datasetId = context.params.datasetId
  const videoId = context.params.videoId
  if (!datasetId || !videoId) {
    return Response.json({ error: '缺少参数' }, { status: 400 })
  }

  const pack = await getStreamPack(db, datasetId, videoId).catch(error => {
    console.error('[api] pack failed', error)
    return null
  })

  if (!pack) {
    return Response.json(
      { error: '找不到这场直播' },
      { status: 404, headers: { 'cache-control': 'no-store' } },
    )
  }

  return Response.json(pack, {
    headers: {
      'cache-control': 'public, max-age=300, stale-while-revalidate=600',
    },
  })
}
