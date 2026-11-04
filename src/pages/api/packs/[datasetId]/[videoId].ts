import type { APIRoute } from 'astro'
import { db } from '@/db/client'
import { getStreamPack } from '@/db/queries/packs'
import { getStream } from '@/db/queries/streams'
import { memberOnlyAccess } from '@/lib/member-access'
import { isMemberOnly } from '@/lib/visibility'

export const prerender = false

export const GET: APIRoute = async (context) => {
  const datasetId = context.params.datasetId
  const videoId = context.params.videoId
  if (!datasetId || !videoId) {
    return Response.json({ error: '缺少参数' }, { status: 400 })
  }

  const { unlocked, keyed } = memberOnlyAccess(context.url)
  if (keyed) context.cache.set(false)

  const summary = await getStream(db, datasetId, videoId).catch(error => {
    console.error('[api] pack stream lookup failed', error)
    return null
  })

  if (summary && isMemberOnly(summary.availability) && !unlocked) {
    return Response.json(
      { error: '这场直播是会员限定，不公开数据' },
      { status: 404, headers: { 'cache-control': 'no-store' } },
    )
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
      'cache-control': keyed
        ? 'private, no-store'
        : 'public, max-age=300, stale-while-revalidate=600',
    },
  })
}
