/**
 * dataset 索引（`<base>/index.json`）的构造入口。
 *
 * 页面启动时直接读对象存储上的这份索引；publish 负责把它和 manifest / insights
 * 一起生成并上传，所以发布后刷新即可生效，不需要重新构建前端。
 */

export const INDEX_SCHEMA = 'yumemita.dashboard.datasets/v1'
export const INDEX_KEY = 'index.json'

export interface DatasetIndexSource {
  id: string
  label: string
  color?: string | null
  avatar?: string | null
  channelId?: string | null
  count: number
  generatedAt?: string | null
}

export interface DatasetIndexEntry {
  id: string
  label: string
  color: string | null
  avatar: string | null
  channelId: string | null
  count: number
  generatedAt: string | null
  manifest: string
  insights: string
}

export interface DatasetIndex {
  schema: string
  generatedAt: string
  datasets: DatasetIndexEntry[]
}

function toIndexEntry(source: DatasetIndexSource): DatasetIndexEntry {
  return {
    id: source.id,
    label: source.label,
    color: source.color ?? null,
    avatar: source.avatar ?? null,
    channelId: source.channelId ?? null,
    count: source.count,
    generatedAt: source.generatedAt ?? null,
    manifest: `data/${source.id}/manifest.json`,
    insights: `data/${source.id}/insights.json`,
  }
}

export function buildDatasetIndex(
  sources: DatasetIndexSource[],
  generatedAt: string,
): DatasetIndex {
  return {
    schema: INDEX_SCHEMA,
    generatedAt,
    datasets: sources.map(toIndexEntry),
  }
}
