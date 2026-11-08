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

  const access = memberOnlyAccess(context.url)
  if (access.keyed) context.cache.set(false)

  try {
    // 场次与 pack 的 6 条查询放进同一个 batch。
    const [streamRows, ...parts] = await runBatch<[StreamQueryRow[], ...StreamPackParts]>(db, [
      selectStreamQuery(db, datasetId, videoId),
      ...buildStreamPackQueries(db, datasetId, videoId, { words: 40, authors: 20 }),
    ])

    const pack = assembleStreamPack(parts)
    if (!pack) {
      return Response.json(
        { error: '找不到这场直播' },
        { status: 404, headers: { 'cache-control': 'no-store' } },
      )
    }

    // 用 payload 自带的 availability 判定，不再依赖另一条查询的结果。
    const summary = streamRows[0] ? mapStreamRow(streamRows[0]) : null
    const availability = pack.video?.availability ?? summary?.availability
    if (isMemberOnly(availability)) {
      if (!access.configured) {
        return Response.json(
          { error: '会员限定访问未配置' },
          { status: 503, headers: { 'cache-control': 'no-store' } },
        )
      }
      if (!access.unlocked) {
        return Response.json(
          { error: '这场直播是会员限定，不公开数据' },
          { status: 403, headers: { 'cache-control': 'no-store' } },
        )
      }
    }

    if (!access.keyed) {
      context.cache.set({
        maxAge: 3600,
        swr: 86400,
        tags: [`stream-${videoId}`, `dataset-${datasetId}`],
      })
    }

    return Response.json(pack, {
      headers: {
        'cache-control': access.keyed
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
