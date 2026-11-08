/** datapack schema 的版本判定。空值与未知版本按 v1 处理，调用方不要再各写一套。 */
export function isV2Pack(schema: string | null | undefined): boolean {
  return schema?.endsWith("/v2") ?? false
}
