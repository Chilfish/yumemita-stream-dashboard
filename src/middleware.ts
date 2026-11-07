import { ADMIN_PASSWORD, ADMIN_SESSION_SECRET, ADMIN_USER } from 'astro:env/server'
import type { APIContext } from 'astro'
import { defineMiddleware } from 'astro:middleware'
import {
  parseBasicAuth,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  safeEqual,
  sessionCookieOptions,
  signSession,
  verifySession,
} from '@/lib/admin-auth'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function isAdminPath(pathname: string): boolean {
  return pathname === '/admin'
    || pathname.startsWith('/admin/')
    || pathname.startsWith('/api/admin/')
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/')
}

function unauthorized(context: APIContext): Response {
  if (isApiPath(context.url.pathname)) {
    return Response.json(
      { ok: false, error: '未认证' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    )
  }

  return new Response('需要登录', {
    status: 401,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'www-authenticate': 'Basic realm="ymmt schedule admin", charset="UTF-8"',
      'cache-control': 'no-store',
    },
  })
}

async function guardAdmin(context: APIContext): Promise<Response | null> {
  if (!ADMIN_USER || !ADMIN_PASSWORD) {
    return Response.json(
      { ok: false, error: '管理端未配置' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }

  const pathname = context.url.pathname
  const secret = ADMIN_SESSION_SECRET || ADMIN_PASSWORD
  const cookie = context.cookies.get(SESSION_COOKIE)?.value
  const cookieValid = await verifySession(cookie, secret)

  const basic = parseBasicAuth(context.request.headers.get('authorization'))
  const basicValid = Boolean(
    basic
    && safeEqual(basic.user, ADMIN_USER)
    && safeEqual(basic.password, ADMIN_PASSWORD),
  )

  if (!cookieValid && !basicValid) return unauthorized(context)

  if (basicValid && !cookieValid && !isApiPath(pathname)) {
    const expMs = Date.now() + SESSION_TTL_MS
    context.cookies.set(
      SESSION_COOKIE,
      await signSession(expMs, secret),
      sessionCookieOptions(context.url.protocol === 'https:'),
    )
  }

  // Cookie 认请求时做一次同源校验；Agent / curl 不带 Origin，按凭据放行。
  if (MUTATING_METHODS.has(context.request.method)) {
    const origin = context.request.headers.get('origin')
    if (origin && origin !== context.url.origin) {
      return Response.json(
        { ok: false, error: '来源不匹配' },
        { status: 403, headers: { 'cache-control': 'no-store' } },
      )
    }
  }

  return null
}

function applyHeaders(context: APIContext, response: Response, admin: boolean): Response {
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

  if (admin) {
    headers.set('cache-control', 'no-store')
    headers.set('x-robots-tag', 'noindex, nofollow')
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.requestId = crypto.randomUUID()
  context.locals.startedAt = performance.now()

  const admin = isAdminPath(context.url.pathname)
  if (admin) {
    const blocked = await guardAdmin(context)
    if (blocked) return applyHeaders(context, blocked, true)
  }

  const response = await next()

  return applyHeaders(context, response, admin)
})
