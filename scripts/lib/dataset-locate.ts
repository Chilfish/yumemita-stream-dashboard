/**
 * 按本地 pack 反查 dataset：`publish push` 与 `data refetch` 共用。
 *
 * 反查只认 `data/<dataset>/<videoId>.datapack.json` 是否存在，不发网络请求：
 * 已经有 pack 的场次归属是确定的，交给 yt-dlp 再问一次频道只会更慢。
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface LocalDatasetSource {
  id: string
  label: string
  datapackDir: string
  channelId?: string | null
}

/** 读 `data-sources.json` 的 datasets；只保留定位需要的字段口径。 */
export function readDatasets(root: string): LocalDatasetSource[] {
  const path = resolve(root, 'data-sources.json')
  const config = JSON.parse(readFileSync(path, 'utf8')) as { datasets?: LocalDatasetSource[] }
  return config.datasets ?? []
}

/** 本地 pack 的绝对路径。 */
export function packPath(
  root: string,
  dataset: LocalDatasetSource,
  videoId: string,
): string {
  return resolve(root, dataset.datapackDir, `${videoId}.datapack.json`)
}

/** 按本地 pack 找 dataset；多个 dataset 都有同一 ID 时取 data-sources.json 里的第一个。 */
export function findDatasetByLocalPack(
  datasets: LocalDatasetSource[],
  root: string,
  videoId: string,
): LocalDatasetSource | null {
  return datasets.find(dataset => existsSync(packPath(root, dataset, videoId))) ?? null
}
