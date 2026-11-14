/**
 * 联动参与者的对账：数据库现状 vs 参与者的目标值。
 *
 * 目标值来自 `resolveParticipants`（手动登记 > 标题推断），ingest 与每日更新
 * 共用同一套口径。daily update 在 ingest 之后跑一次，把手动补登、改登、删登
 * 以及新加的推断规则落到已入库的场次上；只写真正变化的行。
 */
import { and, eq } from 'drizzle-orm'
import type { Db, WriteDb } from '@/db/connection'
import { computeDatasetPublicTotals } from '@/db/queries/dataset-totals'
import { datasetInsights, streams } from '@/db/schema'
import { resolveParticipants, type ParticipantSource } from './collaborations'

export interface CollaborationRow {
  videoId: string
  datasetId: string
  title: string | null
  participants: string[]
}

export interface CollaborationChange {
  videoId: string
  ownerId: string
  before: string[]
  after: string[]
  source: ParticipantSource
}

export interface CollaborationConflict {
  videoId: string
  ownerId: string
}

export interface CollaborationDiff {
  changes: CollaborationChange[]
  unchanged: number
  /** 登记表里有、库里没有的 videoId（reportMissing 时才有）。 */
  missing: string[]
  /** 登记把 owner 也写成参与者：跳过，交给人工修文件。 */
  conflicts: CollaborationConflict[]
  /** owner + 变更前后的参与者；public_totals 只需重算这些成员。 */
  affectedDatasetIds: string[]
}

export interface PlanCollaborationOptions {
  rows: CollaborationRow[]
  /** `content/collaborations.json` 的登记（含显式空数组）。 */
  manual: Map<string, string[]>
  knownDatasetIds: string[]
  /** 没有登记时是否用标题推断补；一次性脚本可关掉。默认 true。 */
  inferFromTitles?: boolean
  /** 刚被 ingest 写过的场次：跳过，避免用内存里的旧值覆盖。 */
  skipVideoIds?: Iterable<string>
  /** 是否报告登记表里在库中找不到的 videoId；默认 false。 */
  reportMissing?: boolean
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/** 纯函数：算出需要写入的变化，不碰数据库。 */
export function planCollaborationUpdates(options: PlanCollaborationOptions): CollaborationDiff {
  const skip = new Set(options.skipVideoIds ?? [])
  const inferFromTitles = options.inferFromTitles ?? true
  const changes: CollaborationChange[] = []
  const conflicts: CollaborationConflict[] = []
  const affected = new Set<string>()
  const seen = new Set<string>()
  let unchanged = 0

  for (const row of options.rows) {
    seen.add(row.videoId)
    if (skip.has(row.videoId)) continue

    const registered = options.manual.get(row.videoId)
    if (registered?.includes(row.datasetId)) {
      conflicts.push({ videoId: row.videoId, ownerId: row.datasetId })
      continue
    }
    if (!inferFromTitles && registered === undefined) continue

    const resolved = resolveParticipants({
      videoId: row.videoId,
      ownerId: row.datasetId,
      title: row.title,
      manual: options.manual,
      knownDatasetIds: options.knownDatasetIds,
    })
    const before = row.participants ?? []
    if (sameIds(before, resolved.ids)) {
      unchanged += 1
      continue
    }

    changes.push({
      videoId: row.videoId,
      ownerId: row.datasetId,
      before,
      after: resolved.ids,
      source: resolved.source,
    })
    affected.add(row.datasetId)
    for (const id of [...before, ...resolved.ids]) affected.add(id)
  }

  const missing = options.reportMissing
    ? [...options.manual.keys()].filter(videoId => !seen.has(videoId))
    : []

  return {
    changes,
    unchanged,
    missing,
    conflicts,
    affectedDatasetIds: [...affected].sort(),
  }
}

/** 把变化写进 `streams.participants`；一场一条 update，整体一个事务。 */
export async function writeCollaborationChanges(
  writeDb: WriteDb,
  changes: CollaborationChange[],
): Promise<void> {
  if (changes.length === 0) return
  await writeDb.transaction(async (tx) => {
    for (const change of changes) {
      await tx
        .update(streams)
        .set({ participants: change.after, updatedAt: new Date() })
        .where(and(eq(streams.videoId, change.videoId), eq(streams.datasetId, change.ownerId)))
    }
  })
}

/**
 * 重算受影响成员的 `dataset_insights.public_totals`。
 * 联动场的参与者变更会改变另一位成员的场次数，所以 owner 与 before / after
 * 都要算一遍；`db totals` 是同一份聚合。
 */
export async function refreshCollaborationTotals(
  readDb: Db,
  writeDb: WriteDb,
  datasetIds: Iterable<string>,
): Promise<{ refreshed: string[], missing: string[] }> {
  const refreshed: string[] = []
  const missing: string[] = []
  for (const datasetId of datasetIds) {
    const publicTotals = await computeDatasetPublicTotals(readDb, datasetId)
    const result = await writeDb
      .update(datasetInsights)
      .set({ publicTotals, generatedAt: new Date() })
      .where(eq(datasetInsights.datasetId, datasetId))
      .returning({ datasetId: datasetInsights.datasetId })
    if (result.length === 0) missing.push(datasetId)
    else refreshed.push(datasetId)
  }
  return { refreshed, missing }
}
