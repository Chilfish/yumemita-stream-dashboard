import type { AstroGlobal } from "astro";
import { MEMBER_ONLY_KEY } from "astro:env/server";
import { MEMBER_ONLY_PARAM, memberOnlyUnlocked } from "./visibility";

export interface MemberOnlyAccess {
  /** 数据是否放行。 */
  unlocked: boolean;
  /** 访问参数是否被接受。只有接受时才需要关闭共享缓存，错误参数不再形成缓存绕过。 */
  keyed: boolean;
  /** 会员限定访问参数是否已配置；未配置时应显式报错，而不是静默锁定。 */
  configured: boolean;
}

function readAccess(url: URL): MemberOnlyAccess {
  const unlocked = memberOnlyUnlocked(url.searchParams.get(MEMBER_ONLY_PARAM), MEMBER_ONLY_KEY);
  return {
    unlocked,
    keyed: unlocked,
    configured: Boolean(MEMBER_ONLY_KEY),
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
