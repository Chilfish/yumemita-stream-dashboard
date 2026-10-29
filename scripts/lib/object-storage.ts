/**
 * 对象存储（Cloudflare R2 / S3 兼容）的上传与 key 约定。
 *
 * 数据只有一份真源：本地 `data/<id>/*.datapack.json`。publish 时由 pack 派生出
 * manifest / insights，与 pack 一起上传到同一个桶，避免两份数据漂移。
 */
import { S3Client } from 'bun'

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

export function createUploader(credentials: Credentials) {
  const client = new S3Client({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    bucket: credentials.bucket,
    endpoint: `https://${credentials.accountId}.r2.cloudflarestorage.com`,
  })

  const prefix = credentials.prefix ? `${credentials.prefix}/` : ''

  return async function put(key: string, body: string): Promise<void> {
    const objectKey = `${prefix}${key}`
    try {
      await client.file(objectKey).write(body, { type: 'application/json' })
    }
    catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      throw new Error(`上传 ${objectKey} 失败：${detail}`, { cause: error })
    }
  }
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
