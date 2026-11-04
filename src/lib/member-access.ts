import type { AstroGlobal } from "astro";
import { MEMBER_ONLY_KEY } from "astro:env/server";
import { MEMBER_ONLY_PARAM, memberOnlyUnlocked } from "./visibility";

export interface MemberOnlyAccess {
  /** 数据是否放行。 */
  unlocked: boolean;
  /** 本次请求是否带了访问参数（带参数时响应一律不进入共享缓存）。 */
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

/** 页面用：处理访问判断，并在带访问参数时关掉 Astro / CDN 缓存。 */
export function memberOnlyCachePolicy(astro: AstroGlobal): MemberOnlyAccess {
  const access = readAccess(astro.url);
  if (access.keyed) {
    astro.cache.set(false);
    astro.response.headers.set("cache-control", "private, no-store");
  }
  return access;
}
