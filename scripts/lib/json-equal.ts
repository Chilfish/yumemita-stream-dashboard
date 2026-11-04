/**
 * 比较两份 JSON 值：对象按键名无序，数组按下标有序。
 * 用于对账 `dataset_insights.totals`——Postgres `jsonb` 不保留对象键的写入顺序，
 * 直接 `JSON.stringify` 会把同一份数据判成不同。
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isNaN(a) && Number.isNaN(b) ? true : Math.abs(a - b) <= 1e-9
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => jsonEqual(item, b[index]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const leftKeys = Object.keys(left)
    if (leftKeys.length !== Object.keys(right).length) return false
    return leftKeys.every(key => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]))
  }
  return false
}
