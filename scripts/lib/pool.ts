/**
 * 分批并发：统一包在 `@chilfish/devkit/pipeline` 之上。
 *
 * 有界并发、重试 / 超时、逐项失败聚合与状态机由 pipeline 负责；这一层只提供项目里
 * 一直在用的 `runPool(items, concurrency, task)` 形状，并统一两件事：
 *
 * - 单项失败只记录、不中断批次（与 pipeline 一致），返回值带计数与失败摘要。
 * - 并发、重试、超时都透传给 pipeline，不再各写一份 worker 循环。
 */
import { runPipeline, type ItemContext } from '@chilfish/devkit/pipeline'

export interface PoolFailure {
  key: string
  error: string
}

export interface RunPoolResult {
  total: number
  succeeded: number
  failed: number
  failures: PoolFailure[]
}

export interface RunPoolOptions<T> {
  /** stage 名，只用于事件与诊断；同一次运行内唯一。 */
  name?: string
  /** 首次失败后的额外尝试次数，默认 0。 */
  retries?: number
  /** 单次尝试超时；超时会 abort `ctx.signal`。 */
  timeoutMs?: number
  /** 稳定唯一的 key；默认用下标（上传项常带 Uint8Array，不适合默认的 JSON.stringify）。 */
  key?: (item: T, index: number) => string
  signal?: AbortSignal
  /** 每项失败时立刻回调，便于沿用现有的逐条日志。 */
  onFailure?: (failure: PoolFailure, item: T) => void
}

let poolSequence = 0

interface Entry<T> {
  item: T
  index: number
}

/**
 * 有限并发跑完一批任务并返回汇总；批次不会因为单项失败而中止。
 *
 * `task` 抛错即该项失败；需要逐条日志的调用方仍可在 task 内 try/catch。
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number, ctx: ItemContext) => unknown,
  options: RunPoolOptions<T> = {},
): Promise<RunPoolResult> {
  const list = [...items]
  if (list.length === 0)
    return { total: 0, succeeded: 0, failed: 0, failures: [] }

  const entries = list.map((item, index): Entry<T> => ({ item, index }))
  const byKey = new Map<string, T>()
  const keyOf = (entry: Entry<T>): string => {
    const key = options.key?.(entry.item, entry.index) ?? String(entry.index)
    byKey.set(key, entry.item)
    return key
  }

  poolSequence += 1
  const result = await runPipeline<Entry<T>>({
    runId: `${(options.name ?? 'pool').replace(/[^\w.-]/g, '-')}-${poolSequence}`,
    stages: [{
      name: options.name ?? 'pool',
      items: entries,
      key: entry => keyOf(entry),
      concurrency,
      retries: options.retries ?? 0,
      timeoutMs: options.timeoutMs,
      run: (entry, ctx) => task(entry.item, entry.index, ctx),
    }],
    signal: options.signal,
  })

  const failures = result.failures.map((failure) => {
    const item = byKey.get(failure.key)
    const summary = { key: failure.key, error: failure.error.message }
    if (item !== undefined)
      options.onFailure?.(summary, item)
    return summary
  })
  const stage = result.stages[0]

  return {
    total: list.length,
    succeeded: stage?.succeeded ?? 0,
    failed: stage?.failed ?? 0,
    failures,
  }
}
