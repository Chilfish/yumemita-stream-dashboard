import type { APIRoute } from 'astro'
import { PURGE_TOKEN } from 'astro:env/server'

export const prerender = false

interface PurgeBody {
  tags?: unknown
}

function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return mismatch === 0
}

function readBearer(header: string | null): string | undefined {
  if (!header) return undefined
  const [scheme, ...rest] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer') return undefined
  const value = rest.join(' ').trim()
  return value.length > 0 ? value : undefined
}

function respond(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

export const POST: APIRoute = async (context) => {
  if (!PURGE_TOKEN) {
    return respond({ success: false, error: 'PURGE_TOKEN 未配置' }, 503)
  }

  const provided = readBearer(context.request.headers.get('authorization'))
  if (!provided || !secureCompare(provided, PURGE_TOKEN)) {
    return respond({ success: false, error: '令牌不匹配' }, 401)
  }

  let body: PurgeBody
  try {
    body = await context.request.json() as PurgeBody
  }
  catch {
    return respond({ success: false, error: '请求体必须是 JSON' }, 400)
  }

  const tags = Array.isArray(body.tags)
    ? body.tags.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0)
    : []
  if (tags.length === 0) {
    return respond({ success: false, error: 'tags 不能为空' }, 400)
  }

  if (context.cache?.enabled !== true) {
    return respond({ success: true, invalidated: false, reason: 'cache disabled', tags }, 200)
  }

  try {
    await context.cache.invalidate({ tags })
    return respond({ success: true, invalidated: true, tags }, 200)
  }
  catch (error) {
    return respond({ success: false, error: error instanceof Error ? error.message : String(error) }, 500)
  }
}

export const GET: APIRoute = async () => {
  return new Response(null, {
    status: 405,
    headers: { 'allow': 'POST', 'cache-control': 'no-store' },
  })
}
