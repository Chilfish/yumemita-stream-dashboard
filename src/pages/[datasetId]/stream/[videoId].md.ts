import type { APIRoute } from 'astro'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { transcripts } from '@/db/schema'
import { getDataset } from '@/db/queries/datasets'
import { getStreamPack } from '@/db/queries/packs'
import { getStream } from '@/db/queries/streams'
import { renderStreamMarkdown } from '@/lib/agent-markdown'
import { DEFAULT_SITE_URL } from '@/lib/site-defaults'

export const prerender = false

interface R2Object {
  text: () => Promise<string>
}

interface R2BucketLike {
  get: (key: string) => Promise<R2Object | null>
}

async function readTranscriptBody(
  locals: App.Locals,
  key: string | null | undefined,
): Promise<string | null> {
  if (!key) return null
  const bucket = (locals as unknown as { runtime?: { env?: { R2?: R2BucketLike } } })
    .runtime?.env?.R2
  if (!bucket) return null

  try {
    const object = await bucket.get(key)
    if (!object) return null
    const raw = await object.text()
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
  const datasetId = context.params.datasetId
  const rawVideoId = context.params.videoId ?? ''
  const videoId = rawVideoId.replace(/\.md$/, '')
  if (!datasetId || !videoId) return notFound()

  const summary = await getStream(db, datasetId, videoId)
  if (!summary) return notFound()

  const [dataset, pack, transcriptRows] = await Promise.all([
    getDataset(db, datasetId),
    getStreamPack(db, datasetId, videoId),
    db
      .select()
      .from(transcripts)
      .where(and(eq(transcripts.datasetId, datasetId), eq(transcripts.videoId, videoId)))
      .limit(1),
  ])

  const transcriptMeta = transcriptRows[0]
  const transcript = await readTranscriptBody(context.locals, transcriptMeta?.r2Key)

  const origin = context.site?.origin ?? DEFAULT_SITE_URL
  const includeTranscript = context.url.searchParams.get('transcript') !== '0'
  const full = context.url.searchParams.get('full') === '1'

  const markdown = renderStreamMarkdown({
    datasetId,
    datasetLabel: dataset?.label ?? datasetId,
    summary,
    pack,
    transcript,
    origin,
    includeTranscript,
    full,
  })

  return new Response(markdown, {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'x-robots-tag': 'noindex',
      'content-signal': 'ai-train=no, search=yes, ai-input=yes',
      'link': `<${origin}/${datasetId}/stream/${videoId}>; rel="alternate"; type="text/html"`,
    },
  })
}

export const HEAD: APIRoute = async (context) => {
  const response = await GET(context)
  return new Response(null, { status: response.status, headers: response.headers })
}
