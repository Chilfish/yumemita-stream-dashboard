import type { APIContext } from 'astro'
import { defineMiddleware } from 'astro:middleware'

function applyHeaders(context: APIContext, response: Response): Response {
  const headers = new Headers(response.headers)

  headers.set('x-request-id', context.locals.requestId)
  headers.set('x-response-time', `${(performance.now() - context.locals.startedAt).toFixed(1)}ms`)

  // Workers Cache 只读 Cloudflare-CDN-Cache-Control；浏览器不认这个头。
  // 同步一份到 Cache-Control，<link rel=prefetch> 预热的结果才能被点击复用。
  const cdnCache = headers.get('cloudflare-cdn-cache-control')
  if (cdnCache && !headers.has('cache-control')) {
    headers.set('cache-control', cdnCache)
  }
  headers.set('x-content-type-options', 'nosniff')
  headers.set('referrer-policy', 'strict-origin-when-cross-origin')
  headers.set('x-frame-options', 'SAMEORIGIN')
  headers.set('permissions-policy', 'geolocation=(), microphone=(), camera=()')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.requestId = crypto.randomUUID()
  context.locals.startedAt = performance.now()

  const response = await next()

  return applyHeaders(context, response)
})
