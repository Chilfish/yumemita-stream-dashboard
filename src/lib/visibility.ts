/**
 * 会员限定场次的公开范围。
 *
 * 数据仍然完整入库（抓取、ingest、对账都不排除），这里只控制公开读取：
 * 默认全部隐藏，只有 URL 带上与环境变量一致的 `?key=` 才放行。
 */

export const MEMBER_ONLY_AVAILABILITY = "subscriber_only";

export const MEMBER_ONLY_PARAM = "key";

export function isMemberOnly(availability: string | null | undefined): boolean {
  return availability === MEMBER_ONLY_AVAILABILITY;
}

export function memberOnlyUnlocked(
  param: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!expected || !param) return false;
  return param === expected;
}
