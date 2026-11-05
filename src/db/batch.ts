import type { Db } from './connection'

type BatchFn = (queries: readonly unknown[]) => Promise<unknown[]>

/**
 * Neon HTTP 的 `db.batch` 把多条语句放进一次 HTTP 请求。
 * 本地 `pg` 直连（drizzle/node-postgres）没有 `batch`，回退到并行执行。
 *
 * 只用于只读查询：neon-http 的 batch 在同一个事务里执行。
 */
export async function runBatch<T extends readonly unknown[]>(
  db: Db,
  queries: readonly PromiseLike<unknown>[],
): Promise<T> {
  const batch = (db as unknown as { batch?: BatchFn }).batch
  if (typeof batch === 'function') {
    return await batch.call(db, [...queries]) as unknown as T
  }
  return await Promise.all(queries) as unknown as T
}
