import type { APIRoute } from 'astro'
import { runBatch } from '@/db/batch'
import { db } from '@/db/client'
import { mapDataset, selectDatasetsQuery, type DatasetQueryRow } from '@/db/queries/datasets'
import { getStreamPack } from '@/db/queries/packs'
import { getStream, mapStreamRow, selectStreamQuery, type StreamQueryRow } from '@/db/queries/streams'
import {
  mapTranscriptMeta,
  selectTranscriptMetaQuery,
  type TranscriptMetaRow,
} from '@/db/queries/transcripts'
import { memberOnlyAccess } from '@/lib/member-access'
import { thumbnailUrl } from '@/lib/media'
import { renderStreamMarkdown } from '@/lib/agent-markdown'
import { readObjectText } from '@/lib/object-read'
import { DEFAULT_SITE_URL } from '@/lib/site-defaults'
import { isMemberOnly } from '@/lib/visibility'

export const prerender = false

async function readTranscriptBody(key: string | null | undefined): Promise<string | null> {
  if (!key) return null

  try {
    const raw = await readObjectText(key)
    if (raw === null) return null
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const body = parsed.body ?? parsed.content ?? parsed.markdown
      return typeof body === 'string' ? body : raw
    }
    catch {
      return raw
    }
  }
  catch (error) {
    console.error('[md] transcript read failed', error)
    return null
  }
}

function notFound(): Response {
  return new Response('# 找不到这场直播\n\n它可能已被删除，或从未被本站收录。\n', {
    status: 404,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  })
}

export const GET: APIRoute = async (context) => {
  try {
    return await handleGet(context)
  }
  catch (error) {
    console.error('[md] failed', error)
    const detail = import.meta.env.DEV && error instanceof Error
      ? `\n\n${error.stack ?? error.message}`
      : ''
    return new Response(`# 500\n\nMarkdown 视图生成失败。${detail}\n`, {
      status: 500,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }
}

async function handleGet(context: Parameters<APIRoute>[0]): Promise<Response> {
  const datasetId = context.params.datasetId
  const rawVideoId = context.params.videoId ?? ''
  const videoId = rawVideoId.replace(/\.md$/, '')
  if (!datasetId || !videoId) return notFound()

  // 第一轮：场次 + 成员 + 逐字稿元数据放进同一个 batch。
  const [streamRows, datasetRows, transcriptRows] = await runBatch<[
    StreamQueryRow[],
    DatasetQueryRow[],
    TranscriptMetaRow[],
  ]>(db, [
    selectStreamQuery(db, datasetId, videoId),
    selectDatasetsQuery(db, datasetId),
    selectTranscriptMetaQuery(db, datasetId, videoId),
  ])

  const summary = streamRows[0] ? mapStreamRow(streamRows[0]) : null
  if (!summary) return notFound()

  const origin = context.site?.origin ?? DEFAULT_SITE_URL
  const access = memberOnlyAccess(context.url)
  if (access.keyed) context.cache.set(false)

  const transcriptMeta = mapTranscriptMeta(transcriptRows[0])
  const dataset = datasetRows[0] ? mapDataset(datasetRows[0]) : null

  // 会员限定：只给标题与封面，和 HTML 页面的公开范围保持一致。
  if (isMemberOnly(summary.availability) && !access.unlocked) {
    if (!access.configured) {
      return new Response('# 503\n\n会员限定访问未配置。\n', {
        status: 503,
        headers: {
          'content-type': 'text/markdown; charset=utf-8',
          'cache-control': 'no-store',
        },
      })
    }
    const image = thumbnailUrl(datasetId, videoId)
    const markdown = [
      `# ${summary.title}`,
      '',
      `> 会员限定直播 · ${summary.date} · ${datasetId}`,
      '',
      '本站不公开该场的弹幕、SC、评论与统计数据。',
      '',
      `![封面](${image})`,
      '',
    ].join('\n')

    return new Response(markdown, {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'cache-control': access.keyed
          ? 'private, no-store'
          : 'public, max-age=3600, stale-while-revalidate=86400',
        'x-robots-tag': 'noindex',
        'content-signal': 'ai-train=no, search=yes, ai-input=yes',
      },
    })
  }

  // 第二轮：pack 的 6 条查询在同一个 batch 里。
  const pack = await getStreamPack(db, datasetId, videoId)

  const transcript = await readTranscriptBody(transcriptMeta?.r2Key)

  const includeTranscript = context.url.searchParams.get('transcript') !== '0'
  const full = context.url.searchParams.get('full') === '1'

  const markdown = renderStreamMarkdown({
    datasetId,
    datasetLabel: dataset?.label ?? datasetId,
    summary,
    pack,
    transcript,
    hasTranscript: Boolean(transcriptMeta),
    origin,
    includeTranscript,
    full,
  })

  const tags = [`stream-${videoId}`, `dataset-${datasetId}`]
  if (transcriptMeta) tags.push('transcripts')
  if (!access.keyed) context.cache.set({ maxAge: 3600, swr: 86400, tags })

  return new Response(markdown, {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': access.keyed
        ? 'private, no-store'
        : 'public, max-age=3600, stale-while-revalidate=86400',
      'x-robots-tag': 'noindex',
      'content-signal': 'ai-train=no, search=yes, ai-input=yes',
      'link': `<${origin}/${datasetId}/stream/${videoId}>; rel="alternate"; type="text/html"`,
    },
  })
}

export const HEAD: APIRoute = async (context) => {
  const datasetId = context.params.datasetId
  const videoId = (context.params.videoId ?? '').replace(/\.md$/, '')
  const headers = {
    'content-type': 'text/markdown; charset=utf-8',
    'x-robots-tag': 'noindex',
    'content-signal': 'ai-train=no, search=yes, ai-input=yes',
  }
  if (!datasetId || !videoId) {
    return new Response(null, { status: 404, headers: { ...headers, 'cache-control': 'no-store' } })
  }

  let summary
  try {
    summary = await getStream(db, datasetId, videoId)
  }
  catch (error) {
    console.error('[md] head lookup failed', error)
    return new Response(null, { status: 503, headers: { ...headers, 'cache-control': 'no-store' } })
  }
  if (!summary) {
    return new Response(null, { status: 404, headers: { ...headers, 'cache-control': 'no-store' } })
  }

  const access = memberOnlyAccess(context.url)
  const memberOnly = isMemberOnly(summary.availability)
  if (memberOnly && !access.configured) {
    return new Response(null, { status: 503, headers: { ...headers, 'cache-control': 'no-store' } })
  }

  return new Response(null, {
    status: 200,
    headers: {
      ...headers,
      'cache-control': access.keyed
        ? 'private, no-store'
        : memberOnly
          ? 'public, max-age=3600, stale-while-revalidate=86400'
          : 'public, max-age=3600',
    },
  })
}
