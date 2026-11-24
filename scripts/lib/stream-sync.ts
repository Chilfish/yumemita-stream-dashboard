/**
 * `db pull` 的增量判定：哪些场次需要从线上覆盖到本机、哪些只在本机存在。
 *
 * 线上是权威源，本机只是开发副本，所以按 `content_hash` 判断而不是时间：
 * 同一份 pack 的 hash 相同，内容就是一致的，跳过省掉整场明细的传输；
 * hash 不同（含任一侧缺失）时以线上为准覆盖。`--full` 时无条件重写。
 * 本机独有的场次单独返回，交给调用方决定是否清理（同步语义下默认清理）。
 * 纯函数，便于单测；真实读写留在 `scripts/commands/db/pull.ts`。
 */

/** 参与比较的最小字段集。 */
export interface StreamPullState {
  videoId: string
  contentHash: string | null
}

export type StreamPullReason = 'missing' | 'changed' | 'forced'

export interface StreamPullEntry {
  videoId: string
  reason: StreamPullReason
}

export interface StreamPullOptions {
  /** 忽略 hash，重写全部场次。 */
  force?: boolean
}

export interface StreamPullPlan {
  /** 需要从线上写入本机的场次，保持线上顺序。 */
  entries: StreamPullEntry[]
  /** 只在本机存在、线上没有的 videoId。 */
  localOnly: string[]
}

/**
 * 算一次同步计划。
 *
 * `missing` = 本机还没有；`changed` = hash 不一致；`forced` = `--full` 强制重写。
 */
export function planStreamPull(
  local: StreamPullState[],
  remote: StreamPullState[],
  options: StreamPullOptions = {},
): StreamPullPlan {
  const localHashes = new Map(local.map(row => [row.videoId, row.contentHash]))
  const remoteIds = new Set(remote.map(row => row.videoId))
  const entries: StreamPullEntry[] = []

  for (const row of remote) {
    if (!localHashes.has(row.videoId)) {
      entries.push({ videoId: row.videoId, reason: 'missing' })
      continue
    }
    if (options.force) {
      entries.push({ videoId: row.videoId, reason: 'forced' })
      continue
    }
    if (localHashes.get(row.videoId) !== row.contentHash)
      entries.push({ videoId: row.videoId, reason: 'changed' })
  }

  const localOnly = local
    .map(row => row.videoId)
    .filter(videoId => !remoteIds.has(videoId))

  return { entries, localOnly }
}
