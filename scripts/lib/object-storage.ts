/**
 * 对象存储（Cloudflare R2 / S3 兼容）的上传与 key 约定。
 *
 * 数据只有一份真源：本地 `data/<id>/*.datapack.json`。publish 时由 pack 派生出
 * manifest / insights，与 pack 一起上传到同一个桶，避免两份数据漂移。
 */
import { S3Client } from 'bun'
import { thumbVariantName } from '../../src/lib/thumb-variants.ts'

export const MANIFEST_SCHEMA = 'yumemita.stream-datapack.batch/v1'
export const INSIGHTS_SCHEMA = 'yumemita.dashboard.insights/v1'

/** datapack / manifest / insights 的公开根地址；构建与校验都用它。 */
export function remoteBase(): string {
  return (process.env.DATAPACK_BASE ?? process.env.VITE_DATAPACK_BASE ?? '').replace(/\/+$/, '')
}

export function datapackKey(datasetId: string, videoId: string): string {
  return `${datasetId}/${videoId}.datapack.json`
}

export function manifestKey(datasetId: string): string {
  return `${datasetId}/manifest.json`
}

export function insightsKey(datasetId: string): string {
  return `${datasetId}/insights.json`
}

/** 组首页的精简数据：stats + 每位成员最新一场 + 最近若干场。 */
export function groupSummaryKey(): string {
  return 'group-summary.json'
}

/** 全组相册的全部精简行；只在 /gallery 按需加载。 */
export function groupGalleryKey(): string {
  return 'group-gallery.json'
}

/** 作者 → 场次索引，只在观众重叠等分析页按需加载。 */
export function authorsKey(datasetId: string): string {
  return `${datasetId}/authors.json`
}

/**
 * 封面图的 key 只由 dataset + videoId 决定，不读 manifest：
 * 离线也能拼出 URL，删掉本地文件重发即可下架。
 */
export function thumbsKey(datasetId: string, videoId: string): string {
  return `${datasetId}/thumbs/${videoId}.jpg`
}

/** WebP 变体：`<dataset>/thumbs/<videoId>.<width>.webp`，宽度见 `src/lib/thumb-variants.ts`。 */
export function thumbVariantKey(datasetId: string, videoId: string, width: number): string {
  return `${datasetId}/thumbs/${thumbVariantName(videoId, width)}`
}

interface Credentials {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  /** 桶内前缀（目录），空串表示直接写桶根目录。 */
  prefix: string
}

export function readCredentials(): Credentials | null {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket)
    return null
  const prefix = (process.env.R2_PREFIX ?? '').replace(/^\/+|\/+$/g, '')
  return { accountId, accessKeyId, secretAccessKey, bucket, prefix }
}

export interface ObjectStore {
  put: (key: string, body: string) => Promise<void>
  /**
   * 二进制上传（封面图等）。Bun 的 S3 写入只能在 `type` 里给 Content-Type，
   * 没有自定义 `Cache-Control` 的入口；长缓存靠桶侧规则，不在这里假装设置。
   */
  putObject: (key: string, body: Uint8Array, contentType: string) => Promise<void>
  /** 读取对象；不存在时返回 null。 */
  get: (key: string) => Promise<string | null>
  /** 桶内对象相对 `R2_PREFIX` 的 key → 字节数；用于增量发布时核对远端。 */
  list: () => Promise<Map<string, number>>
}

export function createObjectStore(credentials: Credentials): ObjectStore {
  const client = new S3Client({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    bucket: credentials.bucket,
    endpoint: `https://${credentials.accountId}.r2.cloudflarestorage.com`,
  })

  const prefix = credentials.prefix ? `${credentials.prefix}/` : ''

  async function put(key: string, body: string): Promise<void> {
    const objectKey = `${prefix}${key}`
    try {
      await client.file(objectKey).write(body, { type: 'application/json' })
    }
    catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      throw new Error(`上传 ${objectKey} 失败：${detail}`, { cause: error })
    }
  }

  async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const objectKey = `${prefix}${key}`
    try {
      await client.file(objectKey).write(body, { type: contentType })
    }
    catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      throw new Error(`上传 ${objectKey} 失败：${detail}`, { cause: error })
    }
  }

  async function get(key: string): Promise<string | null> {
    const objectKey = `${prefix}${key}`
    const file = client.file(objectKey)
    try {
      if (!(await file.exists()))
        return null
      return await file.text()
    }
    catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      throw new Error(`读取 ${objectKey} 失败：${detail}`, { cause: error })
    }
  }

  async function list(): Promise<Map<string, number>> {
    const sizes = new Map<string, number>()
    let continuationToken: string | undefined
    do {
      let page
      try {
        page = await client.list({ prefix, continuationToken })
      }
      catch (error) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        throw new Error(`列出 ${prefix || '桶根'} 下的对象失败：${detail}`, { cause: error })
      }
      for (const object of page.contents ?? []) {
        if (typeof object.size !== 'number') continue
        const key = prefix && object.key.startsWith(prefix) ? object.key.slice(prefix.length) : object.key
        sizes.set(key, object.size)
      }
      continuationToken = page.isTruncated ? page.nextContinuationToken : undefined
    } while (continuationToken)
    return sizes
  }

  return { put, putObject, get, list }
}

/** 有限并发地跑完一批任务，避免把 200+ 个 PUT 同时打出去。 */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      const item = items[cursor]
      cursor += 1
      if (item === undefined)
        return
      await task(item)
    }
  })
  await Promise.all(workers)
}
