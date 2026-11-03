/** 封面地址：优先 R2 公开域名，未配置时回退同源 `/data` 快照。 */
export function thumbnailUrl(datasetId: string, videoId: string): string {
  const base = (import.meta.env.PUBLIC_R2_BASE ?? '').replace(/\/+$/, '')
  const path = `${datasetId}/thumbs/${encodeURIComponent(videoId)}.jpg`
  return base ? `${base}/${path}` : `/data/${path}`
}

export function absoluteUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}
