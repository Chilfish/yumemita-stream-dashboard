import type { APIRoute } from 'astro'
import { runBatch } from '@/db/batch'
import { db } from '@/db/client'
import {
  buildStreamSearchCountQuery,
  buildStreamSearchQuery,
  mapStreamSearchRows,
  type StreamSearchRow,
} from '@/db/queries/streams'
import { CACHE_TAGS } from '@/lib/cache-tags'
import { DEFAULT_SITE_URL } from '@/lib/site-defaults'
import { parseStreamSearchParams, toStreamSearchItem } from '@/lib/stream-search'
import type { StreamSearchResponse, StreamSummary } from '@/types/dataset'

export const prerender = false

function noStore(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } })
}

/** 跨成员搜索已结束场次：返回摘要、内容类型与可继续读取的链接。 */
export const GET: APIRoute = async (context) => {
  const { params, error } = parseStreamSearchParams(context.url.searchParams)
  if (error) {
    return Response.json(
      { error },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    )
  }

  const origin = (context.site?.origin ?? DEFAULT_SITE_URL).replace(/\/+$/, '')

  try {
    const [rows, countRows] = await runBatch<[StreamSearchRow[], { count: number }[]]>(db, [
      buildStreamSearchQuery(db, params),
      buildStreamSearchCountQuery(db, params),
    ])

    const streams = mapStreamSearchRows(rows, params.offset).map(summary =>
      toStreamSearchItem(summary as StreamSummary & { datasetId: string }, origin),
    )
    const total = countRows[0]?.count ?? 0
    const nextOffset = params.offset + streams.length < total
      ? params.offset + streams.length
      : null

    const body: StreamSearchResponse = {
      schema: 'yumemita.stream-search/v1',
      query: params,
      total,
      count: streams.length,
      nextOffset,
      streams,
    }

    context.cache.set({
      maxAge: 300,
      swr: 3600,
      tags: [CACHE_TAGS.streams],
    })

    return Response.json(body, {
      headers: {
        'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
        'link': `<${origin}/schemas/stream-search.v1.json>; rel="describedby"; type="application/schema+json"`,
      },
    })
  }
  catch (cause) {
    console.error('[api] streams search failed', cause)
    return noStore('数据读取失败', 503)
  }
}
