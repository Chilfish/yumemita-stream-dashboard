import type { AstroGlobal } from 'astro'
import type { SeoContext } from '@/lib/seo'
import { buildSeo, type SeoMeta } from '@/lib/seo'
import { DEFAULT_SITE_URL } from '@/lib/site-defaults'
import { absoluteUrl, thumbnailUrl } from '@/lib/media'

/** 请求级 SEO 上下文：origin / base / pathname 都从 Astro 拿。 */
export function pageSeo(
  astro: AstroGlobal,
  input: Omit<SeoContext, 'origin' | 'basePath' | 'pathname'> & { imageStream?: { datasetId: string, videoId: string } | null },
): SeoMeta {
  const origin = astro.site?.origin ?? DEFAULT_SITE_URL
  const basePath = import.meta.env.BASE_URL.replace(/\/+$/, '')
  const image = input.imageStream
    ? absoluteUrl(origin, thumbnailUrl(input.imageStream.datasetId, input.imageStream.videoId))
    : input.image ?? null

  return buildSeo({
    ...input,
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
