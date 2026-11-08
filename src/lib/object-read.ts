import { env } from 'cloudflare:workers'
import { isLocalUrl } from './local-url'
import type { ObjectReadResult } from './object-result'

/**
 * 读取对象存储里的文本对象（逐字稿正文等）。
 *
 * 生产走 Worker 的 R2 binding；本地开发没有 binding（或 binding 是空桶）时，
 * 回退到 `PUBLIC_R2_BASE` 的匿名读地址。只有 `PUBLIC_R2_BASE` 指向本机时才允许回退，
 * 因此 `LOCAL=1` 下的 dev 与 preview 都能读 SILO，生产（远程域名）不会绕过 binding。
 *
 * 返回可区分结果：调用方需要把「未命中」「未配置」「读取失败」映射成不同状态，
 * 不能再用一个 `null` 表示全部。
 */

interface R2ObjectLike {
  text: () => Promise<string>
}

interface R2BucketLike {
  get: (key: string) => Promise<R2ObjectLike | null>
}

function localBase(): string | null {
  const base = (import.meta.env.PUBLIC_R2_BASE ?? '').replace(/\/+$/, '')
  return isLocalUrl(base) ? base : null
}

export async function readObject(key: string): Promise<ObjectReadResult> {
  const bucket = (env as unknown as { R2?: R2BucketLike }).R2
  if (bucket) {
    try {
      const object = await bucket.get(key)
      if (object) return { kind: 'hit', text: await object.text() }
    }
    catch (error) {
      console.error('[object] binding read failed', error)
      return { kind: 'error', error }
    }
  }

  const base = localBase()
  if (!base) {
    // 没有 binding，也没有本地回退：生产配置缺失，不应报成「不存在」。
    return bucket ? { kind: 'miss' } : { kind: 'unconfigured' }
  }

  try {
    const response = await fetch(`${base}/${key}`)
    if (response.ok) return { kind: 'hit', text: await response.text() }
    if (response.status === 404) return { kind: 'miss' }
    return { kind: 'error', error: new Error(`object read failed: ${response.status}`) }
  }
  catch (error) {
    console.error('[object] local read failed', error)
    return { kind: 'error', error }
  }
}

/** 兼容旧调用方：只关心正文时返回字符串或 null。新代码请用 `readObject`。 */
export async function readObjectText(key: string): Promise<string | null> {
  const result = await readObject(key)
  return result.kind === 'hit' ? result.text : null
}
