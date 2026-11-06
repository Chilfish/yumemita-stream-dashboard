import type { APIRoute } from 'astro'
import { db } from '@/db/client'
import { getStream } from '@/db/queries/streams'
import { getTranscriptMeta } from '@/db/queries/transcripts'
import { memberOnlyAccess } from '@/lib/member-access'
import { readObjectText } from '@/lib/object-read'
import { isMemberOnly } from '@/lib/visibility'

export const prerender = false

function json(body: unknown, status: number, cacheControl = 'no-store'): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': cacheControl },
  })
}

/** 逐字稿正文由 Worker 从 R2 读取，桶的公开域名只用于封面与表情。 */
export const GET: APIRoute = async (context) => {
  const datasetId = context.params.datasetId
  const videoId = context.params.videoId
  if (!datasetId || !videoId) {
    return json({ error: '缺少参数' }, 400)
  }

  const { unlocked, keyed } = memberOnlyAccess(context.url)
  if (keyed) context.cache.set(false)

  const summary = await getStream(db, datasetId, videoId).catch((error) => {
    console.error('[api] transcript stream lookup failed', error)
    return null
  })
  if (summary && isMemberOnly(summary.availability) && !unlocked) {
    return json({ error: '这场直播是会员限定，不公开逐字稿' }, 404)
  }

  const meta = await getTranscriptMeta(db, datasetId, videoId).catch((error) => {
    console.error('[api] transcript lookup failed', error)
    return undefined
  })
  if (meta === undefined) {
    return json({ error: '逐字稿查询失败' }, 503)
  }
  if (!meta) {
    return json({ error: '这场还没有逐字稿' }, 404)
  }

  try {
    const body = await readObjectText(meta.r2Key)
    if (body === null) {
      return json({ error: '逐字稿暂时不可用' }, 503)
    }

    if (!keyed) {
      context.cache.set({
        maxAge: 3600,
        swr: 86400,
        tags: [`stream-${videoId}`, `dataset-${datasetId}`, 'transcripts'],
      })
    }

    return new Response(body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        ...(keyed ? { 'cache-control': 'private, no-store' } : {}),
      },
    })
  }
  catch (error) {
    console.error('[api] transcript read failed', error)
    return json({ error: '逐字稿暂时不可用' }, 503)
  }
}
