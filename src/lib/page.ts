import type { AstroGlobal } from 'astro'
import type { SeoContext, SeoDataset } from '@/lib/seo'
import { buildSeo, type SeoMeta } from '@/lib/seo'
import { DEFAULT_SITE_URL } from '@/lib/site-defaults'
import { absoluteUrl, avatarUrl, thumbnailUrl } from '@/lib/media'

type PageSeoInput = Omit<SeoContext, 'origin' | 'basePath' | 'pathname' | 'dataset'> & {
  imageStream?: { datasetId: string, videoId: string } | null
  /** `avatar` 是对象存储里的相对 key；这里解析成绝对地址后交给 `Person.image`。 */
  dataset?: (SeoDataset & { avatar?: string | null }) | null
}

/** 请求级 SEO 上下文：origin / base / pathname 都从 Astro 拿。 */
export function pageSeo(astro: AstroGlobal, input: PageSeoInput): SeoMeta {
  const origin = astro.site?.origin ?? DEFAULT_SITE_URL
  const basePath = import.meta.env.BASE_URL.replace(/\/+$/, '')
  const image = input.imageStream
    ? absoluteUrl(origin, thumbnailUrl(input.imageStream.datasetId, input.imageStream.videoId))
    : input.image ?? null
  const resolvedAvatar = avatarUrl(input.dataset?.avatar)
  const dataset = input.dataset
    ? {
        ...input.dataset,
        avatarImage: resolvedAvatar
          ? absoluteUrl(origin, resolvedAvatar)
          : input.dataset.avatarImage ?? null,
      }
    : null

  return buildSeo({
    ...input,
    dataset,
    image,
    origin,
    basePath,
    pathname: astro.url.pathname,
  })
}

export function requestParams(astro: AstroGlobal): Record<string, string> {
  return Object.fromEntries(
    Object.entries(astro.params).filter((entry): entry is [string, string] =>
      typeof entry[1] === 'string',
    ),
  )
}

export function requestSearch(astro: AstroGlobal): string {
  return astro.url.search
}
