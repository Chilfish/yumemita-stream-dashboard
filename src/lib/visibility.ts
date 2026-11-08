/**
 * 会员限定场次的公开范围。
 *
 * 封面、标题、时间等元数据属于公开信息：列表、相册与聚合统计照常包含这些场次。
 * 弹幕、评论、SC 等明细只在单场详情、`.md` 与 `/api/*` 里按访问策略放行。
 */

import { safeEqual } from "./secure-compare";

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
  return safeEqual(param, expected);
}
