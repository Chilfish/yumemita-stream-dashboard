/** 缓存 tag 的唯一词表：routeRules、页面与 purge 脚本都从这里取，避免三方漂移。 */
export const CACHE_TAGS = {
  group: "group",
  gallery: "gallery",
  schedule: "schedule",
  datasets: "datasets",
  streams: "streams",
  transcripts: "transcripts",
  sitemap: "sitemap",
  llms: "llms",
  compare: "compare",
} as const;

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

export function datasetTag(datasetId: string): string {
  return `dataset-${datasetId}`;
}

export function streamTag(videoId: string): string {
  return `stream-${videoId}`;
}

export const ALL_CACHE_TAGS: string[] = Object.values(CACHE_TAGS);
