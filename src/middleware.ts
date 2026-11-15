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
import { isAdminPath, isApiPath } from '@/lib/admin-path'
import { contentSecurityPolicy } from '@/lib/security-headers'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** dev 模式有 Vite HMR websocket，CSP 只在构建产物里下发。 */
const CSP = import.meta.env.PROD
  ? contentSecurityPolicy({ assetOrigin: import.meta.env.PUBLIC_R2_BASE })
  : null

/** 本地开发 / 预览走 http 是正常的，别把 localhost 也 301 到 https。 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname) || hostname.endsWith('.local')
}

/**
 * 线上不允许明文访问：`http://` 一律 301 到同 host + path + query 的 https。
 * Cloudflare 侧没开 Always Use HTTPS 时，这是唯一能保证的地方。
 */
function forceHttps(context: APIContext): Response | null {
  if (context.url.protocol !== 'http:') return null
  if (isLocalHost(context.url.hostname)) return null

  const target = new URL(context.url.href)
  target.protocol = 'https:'
  return new Response(null, {
    status: 301,
    headers: {
      location: target.href,
      'cache-control': 'public, max-age=3600',
    },
  })
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

async function hasAdminSession(context: APIContext): Promise<boolean> {
  if (!ADMIN_SESSION_SECRET) return false
  const cookie = context.cookies.get(SESSION_COOKIE)?.value
  return verifySession(cookie, ADMIN_SESSION_SECRET)
}

async function guardAdmin(context: APIContext): Promise<Response | null> {
  if (!ADMIN_USER || !ADMIN_PASSWORD) {
    return Response.json(
      { ok: false, error: '管理端未配置' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
  // 会话密钥与登录密码分离：缺少密钥时拒绝管理端，避免用密码作为 HMAC 密钥。
  if (!ADMIN_SESSION_SECRET) {
    return Response.json(
      { ok: false, error: '管理端会话密钥未配置' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }

  const pathname = context.url.pathname
  const secret = ADMIN_SESSION_SECRET
  const cookieValid = context.locals.admin

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

  // Cookie 认请求时做一次同源校验。Agent / curl 通常不带 Origin，此时要求显式 Authorization，
  // 避免只靠 Cookie 的无 Origin 请求绕过 CSRF 约束。
  if (MUTATING_METHODS.has(context.request.method)) {
    const headers = context.request.headers
    const origin = headers.get('origin')
    const fetchSite = headers.get('sec-fetch-site')
    if (origin && origin !== context.url.origin) {
      return Response.json(
        { ok: false, error: '来源不匹配' },
        { status: 403, headers: { 'cache-control': 'no-store' } },
      )
    }
    if (!origin) {
      const authorized = Boolean(headers.get('authorization'))
      const crossSite = fetchSite != null && fetchSite !== 'same-origin' && fetchSite !== 'none'
      if (crossSite || (!fetchSite && !authorized)) {
        return Response.json(
          { ok: false, error: '来源不匹配' },
          { status: 403, headers: { 'cache-control': 'no-store' } },
        )
      }
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

  // 声明 HSTS 需要 TLS 真的生效；本地 http 下发了也没用，还会污染 127.0.0.1 的后续访问。
  if (context.url.protocol === 'https:') {
    headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains')
  }

  // Astro 出去的 `text/html` 不带 charset，按 Content-Type 解码的客户端会退回 latin-1。
  const contentType = headers.get('content-type')
  if (contentType && /^text\/[^;]+$/i.test(contentType)) {
    headers.set('content-type', `${contentType}; charset=utf-8`)
  }

  if (CSP && contentType?.toLowerCase().startsWith('text/html')) {
    headers.set('content-security-policy', CSP)
  }

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

  const redirect = forceHttps(context)
  if (redirect) return redirect

  // 预渲染页在构建期也会跑一遍 middleware，此时 `request.headers` 不可用，读 Cookie 会触发
  // Astro 的警告；这些页面最终是静态 HTML，会话状态没有意义。
  context.locals.admin = context.isPrerendered ? false : await hasAdminSession(context)

  const admin = isAdminPath(context.url.pathname)
  if (admin) {
    const blocked = await guardAdmin(context)
    if (blocked) return applyHeaders(context, blocked, true)
  }

  const response = await next()

  return applyHeaders(context, response, admin)
})
