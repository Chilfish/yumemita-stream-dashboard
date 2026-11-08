/**
 * 抓取哨兵（`chat-unavailable.txt` / `vstats-unavailable.txt`）的有效期。
 *
 * 哨兵只应以「最近一次判定」为准；没有有效期时，一次临时失败会变成永久跳过。
 * 超过有效期后视为不存在，下一轮重新尝试。
 */
import { existsSync, statSync } from 'node:fs'

export const SENTINEL_TTL_DAYS = 30
const DAY_MS = 86_400_000

export function sentinelIsFresh(
  path: string,
  now: number = Date.now(),
  ttlDays: number = SENTINEL_TTL_DAYS,
): boolean {
  if (!existsSync(path)) return false
  try {
    const age = now - statSync(path).mtimeMs
    return age >= 0 && age < ttlDays * DAY_MS
  }
  catch {
    return false
  }
}
