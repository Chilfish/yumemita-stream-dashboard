/** 站点根地址与子路径 base：canonical / OG / sitemap 与路由 basename 共用。 */

export function siteBasePath(): string {
  return import.meta.env.BASE_URL.replace(/\/+$/, "");
}

/** 配置了 `VITE_SITE_URL` 时优先用它（生产域名）；本地开发回退到当前 origin。 */
export function siteOrigin(): string {
  const configured = (import.meta.env.VITE_SITE_URL ?? "").replace(/\/+$/, "");
  if (configured) return configured;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

/** 封面等资源地址可能是同源相对路径，OG 需要绝对地址。 */
export function absoluteAssetUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === "undefined") return url;
  return new URL(url, window.location.href).href;
}
