/** JST（UTC+9）ISO 字符串；pack 内所有时刻统一用这个口径。 */
const JST_OFFSET_MIN = 540

export function jstIso(seconds: number): string {
  const d = new Date((seconds + JST_OFFSET_MIN * 60) * 1000)
  return `${d.toISOString().slice(0, 19)}+09:00`
}
