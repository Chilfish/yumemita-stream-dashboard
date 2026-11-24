import type { DatasetIndexEntry } from '@/types/dataset'

/** 官方账号的 `kind`；缺省视为成员（旧数据没有这个字段）。 */
export const OFFICIAL_KIND = 'official'

/** 第三方联动聚合账号：没有固定频道，场次来源分散，列表里固定排在官方分组最后。 */
export const AGGREGATE_OFFICIAL_ID = 'other'

export function isOfficialDataset(dataset: Pick<DatasetIndexEntry, 'kind'>): boolean {
  return dataset.kind === OFFICIAL_KIND
}

/**
 * 组级口径的成员数：只数 `kind='member'`。
 * SEO 文案、页头事实串、对比默认集合都用它，不要把官方账号算成成员。
 */
export function countMembers(datasets: Pick<DatasetIndexEntry, 'kind'>[]): number {
  return datasets.filter(dataset => !isOfficialDataset(dataset)).length
}
