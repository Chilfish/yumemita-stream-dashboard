/** 封面 / 表情等公开静态资源地址。数据本身由 SSR 查库，浏览器只读这两类对象。 */
import { emojiFileName, emojiFolder } from '@/lib/emoji'
import { THUMB_VARIANTS, thumbVariantName } from '@/lib/thumb-variants'

const PUBLIC_BASE = (import.meta.env.PUBLIC_R2_BASE ?? '').replace(/\/+$/, '')

function assetUrl(path: string): string {
  return PUBLIC_BASE ? `${PUBLIC_BASE}/${path}` : `/data/${path}`
}

/** 单场封面原图：`<dataset>/thumbs/<videoId>.jpg`。 */
export function thumbnailUrl(datasetId: string, videoId: string): string {
  return assetUrl(`${datasetId}/thumbs/${encodeURIComponent(videoId)}.jpg`)
}

/** 480 / 960 / 1280w 的 WebP 变体，交给浏览器按 `sizes` 选择。 */
export function thumbnailSrcSet(datasetId: string, videoId: string): string {
  const id = encodeURIComponent(videoId)
  return THUMB_VARIANTS.map(
    width => `${assetUrl(`${datasetId}/thumbs/${thumbVariantName(id, width)}`)} ${width}w`,
  ).join(', ')
}

/** 频道专属表情：`emojis/<dataset>/<hash>.png`；id 不合法时返回 null。 */
export function emojiUrl(datasetId: string, emojiId: string): string | null {
  const file = emojiFileName(emojiId)
  if (!file) return null
  return assetUrl(`emojis/${emojiFolder(datasetId, emojiId)}/${file}`)
}

export function absoluteUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

const emojiIndexCache = new Map<string, Promise<Record<string, string>>>()

/** 频道表情的 id → 名称索引；没跑过 fetch:emoji 的 dataset 返回空表。 */
export function fetchEmojiIndex(datasetId: string): Promise<Record<string, string>> {
  const cached = emojiIndexCache.get(datasetId)
  if (cached) return cached

  const request = fetch(assetUrl(`emojis/${datasetId}/index.json`), {
    headers: { Accept: 'application/json' },
  })
    .then(async (response) => {
      if (response.status === 404) return {}
      if (!response.ok) throw new Error('表情索引加载失败。')
      const file = (await response.json()) as { names?: Record<string, string> }
      return file?.names ?? {}
    })
    .catch((error: unknown) => {
      emojiIndexCache.delete(datasetId)
      throw error
    })

  emojiIndexCache.set(datasetId, request)
  return request
}
