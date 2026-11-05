import type { APIRoute } from 'astro'
import { runBatch } from '@/db/batch'
import { db } from '@/db/client'
import { assembleStreamPack, buildStreamPackQueries, type StreamPackParts } from '@/db/queries/packs'
import { mapStreamRow, selectStreamQuery, type StreamQueryRow } from '@/db/queries/streams'
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

  try {
    // 场次与 pack 的 6 条查询放进同一个 batch。
    const [streamRows, ...parts] = await runBatch<[StreamQueryRow[], ...StreamPackParts]>(db, [
      selectStreamQuery(db, datasetId, videoId),
      ...buildStreamPackQueries(db, datasetId, videoId, { words: 40, authors: 20 }),
    ])

    const summary = streamRows[0] ? mapStreamRow(streamRows[0]) : null
    if (summary && isMemberOnly(summary.availability) && !unlocked) {
      return Response.json(
        { error: '这场直播是会员限定，不公开数据' },
        { status: 404, headers: { 'cache-control': 'no-store' } },
      )
    }

    const pack = assembleStreamPack(parts)
    if (!pack) {
      return Response.json(
        { error: '找不到这场直播' },
        { status: 404, headers: { 'cache-control': 'no-store' } },
      )
    }

    if (!keyed) {
      context.cache.set({
        maxAge: 3600,
        swr: 86400,
        tags: [`stream-${videoId}`, `dataset-${datasetId}`],
      })
    }

    return Response.json(pack, {
      headers: {
        'cache-control': keyed
          ? 'private, no-store'
          : 'public, max-age=3600, stale-while-revalidate=86400',
      },
    })
  }
  catch (error) {
    console.error('[api] pack failed', error)
    return Response.json(
      { error: '数据读取失败' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}
