import { env } from 'cloudflare:workers'
import { isLocalUrl } from './local-url'

/**
 * 读取对象存储里的文本对象（逐字稿正文等）。
 *
 * 生产走 Worker 的 R2 binding；本地开发没有 binding（或 binding 是空桶）时，
 * 回退到 `PUBLIC_R2_BASE` 的匿名读地址。只有 `PUBLIC_R2_BASE` 指向本机时才允许回退，
 * 因此 `LOCAL=1` 下的 dev 与 preview 都能读 SILO，生产（远程域名）不会绕过 binding。
 */

interface R2ObjectLike {
  text: () => Promise<string>
}

interface R2BucketLike {
  get: (key: string) => Promise<R2ObjectLike | null>
}

export async function readObjectText(key: string): Promise<string | null> {
  const bucket = (env as unknown as { R2?: R2BucketLike }).R2
  if (bucket) {
    const object = await bucket.get(key)
    if (object) return await object.text()
  }

  const base = (import.meta.env.PUBLIC_R2_BASE ?? '').replace(/\/+$/, '')
  if (!isLocalUrl(base)) return null

  try {
    const response = await fetch(`${base}/${key}`)
    if (!response.ok) return null
    return await response.text()
  }
  catch (error) {
    console.error('[object] local read failed', error)
    return null
  }
}
