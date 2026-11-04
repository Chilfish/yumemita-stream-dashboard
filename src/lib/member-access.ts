import type { AstroGlobal } from "astro";
import { MEMBER_ONLY_KEY } from "astro:env/server";
import { MEMBER_ONLY_PARAM, memberOnlyUnlocked } from "./visibility";

export interface MemberOnlyAccess {
  /** `?key=` 与环境变量一致；数据是否放行。 */
  unlocked: boolean;
  /** URL 带了 `?key=`（不论对错）。带 key 的响应一律不进入共享缓存。 */
  keyed: boolean;
}

function readAccess(url: URL): MemberOnlyAccess {
  return {
    unlocked: memberOnlyUnlocked(url.searchParams.get(MEMBER_ONLY_PARAM), MEMBER_ONLY_KEY),
    keyed: url.searchParams.has(MEMBER_ONLY_PARAM),
  };
}

export function memberOnlyAccess(url: URL): MemberOnlyAccess {
  return readAccess(url);
}

/** 页面用：处理访问判断，并在带 key 时关掉 Astro / CDN 缓存。 */
export function memberOnlyCachePolicy(astro: AstroGlobal): MemberOnlyAccess {
  const access = readAccess(astro.url);
  if (access.keyed) {
    astro.cache.set(false);
    astro.response.headers.set("cache-control", "private, no-store");
  }
  return access;
}
