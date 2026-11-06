/** 调用 Worker 内部 purge 端点；zone 级 purge 不影响 Workers Cache，只能走这里。 */
import { isLocalMode } from './local-config.ts'

export interface PurgeOptions {
  /** 站点根地址；默认读 SITE_URL。 */
  siteUrl?: string
  /** 内部端点令牌；默认读 PURGE_TOKEN。 */
  token?: string
  tags: string[]
}

export interface PurgeResult {
  success: boolean
  /** 没配置站点或令牌时跳过，不视为失败。 */
  skipped?: boolean
  reason?: string
  status?: number
  body?: unknown
}

export async function purgeCache(options: PurgeOptions): Promise<PurgeResult> {
  if (isLocalMode()) {
    return { success: true, skipped: true, reason: 'LOCAL=1：本地开发不做线上缓存失效' }
  }

  const siteUrl = (options.siteUrl ?? process.env.SITE_URL ?? '').replace(/\/+$/, '')
  const token = options.token ?? process.env.PURGE_TOKEN ?? ''
  const tags = [...new Set(options.tags.filter(Boolean))]

  if (!siteUrl || !token) {
    return { success: false, skipped: true, reason: '未配置 SITE_URL / PURGE_TOKEN' }
  }
  if (tags.length === 0) {
    return { success: true, body: { message: '没有需要失效的 tag' } }
  }

  try {
    const response = await fetch(`${siteUrl}/api/internal/cache/purge`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(20_000),
    })
    const body = await response.json().catch(() => null) as { success?: boolean } | null
    return {
      success: response.ok && body?.success !== false,
      status: response.status,
      body,
    }
  }
  catch (error) {
    return {
      success: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}
