import type { APIRoute } from 'astro'
import { SCHEMAS, type SchemaName } from '@/lib/json-schema'

export const prerender = false

export const GET: APIRoute = ({ params }) => {
  const name = params.name as SchemaName
  const entry = Object.hasOwn(SCHEMAS, name) ? SCHEMAS[name] : undefined
  if (!entry) {
    return new Response(JSON.stringify({ error: '找不到这个 schema' }), {
      status: 404,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }

  return new Response(JSON.stringify(entry.schema, null, 2), {
    headers: {
      'content-type': 'application/schema+json; charset=utf-8',
      // schema 只随部署变化，按 tag 失效即可。
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  })
}
