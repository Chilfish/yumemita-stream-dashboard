import type { APIRoute } from 'astro'
import { db } from '@/db/client'
import { getStream } from '@/db/queries/streams'
import { getTranscriptMeta } from '@/db/queries/transcripts'
import { memberOnlyAccess } from '@/lib/member-access'
import { readObject } from '@/lib/object-read'
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

  const access = memberOnlyAccess(context.url)
  if (access.keyed) context.cache.set(false)

  let summary
  try {
    summary = await getStream(db, datasetId, videoId)
  }
  catch (error) {
    console.error('[api] transcript stream lookup failed', error)
    return json({ error: '场次查询失败' }, 503)
  }
  // 查不到场次时不能继续：否则会员限定判定会被跳过，孤儿逐字稿会原样返回。
  if (!summary) {
    return json({ error: '找不到这场直播' }, 404)
  }
  if (isMemberOnly(summary.availability)) {
    if (!access.configured) {
      return json({ error: '会员限定访问未配置' }, 503)
    }
    if (!access.unlocked) {
      return json({ error: '这场直播是会员限定，不公开逐字稿' }, 403)
    }
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

  const result = await readObject(meta.r2Key)
  if (result.kind === 'miss') {
    return json({ error: '逐字稿不存在' }, 404)
  }
  if (result.kind === 'unconfigured') {
    return json({ error: '对象存储未配置' }, 503)
  }
  if (result.kind === 'error') {
    console.error('[api] transcript read failed', result.error)
    return json({ error: '逐字稿暂时不可用' }, 503)
  }

  if (!access.keyed) {
    context.cache.set({
      maxAge: 3600,
      swr: 86400,
      tags: [`stream-${videoId}`, `dataset-${datasetId}`, 'transcripts'],
    })
  }

  return new Response(result.text, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(access.keyed ? { 'cache-control': 'private, no-store' } : {}),
    },
  })
}
