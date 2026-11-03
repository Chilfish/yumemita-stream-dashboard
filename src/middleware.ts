import type { APIContext } from 'astro'
import { defineMiddleware } from 'astro:middleware'

function applyHeaders(context: APIContext, response: Response): Response {
  const headers = new Headers(response.headers)

  headers.set('x-request-id', context.locals.requestId)
  headers.set('x-response-time', `${(performance.now() - context.locals.startedAt).toFixed(1)}ms`)
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
