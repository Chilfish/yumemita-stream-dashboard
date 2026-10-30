import { useEffect } from "react";
import { SITE_NAME, TWITTER_SITE, type SeoMeta } from "@/lib/seo";

type ManagedMeta = { attr: "name" | "property"; key: string };

/**
 * 受管的 meta key。每次路由切换都整组写一遍，当前页面没有的 key 直接删除，
 * 避免 SPA 导航后残留上一页的 og / twitter 标签。
 */
const MANAGED_META: ManagedMeta[] = [
  { attr: "name", key: "description" },
  { attr: "name", key: "robots" },
  { attr: "name", key: "twitter:card" },
  { attr: "name", key: "twitter:site" },
  { attr: "name", key: "twitter:title" },
  { attr: "name", key: "twitter:description" },
  { attr: "name", key: "twitter:image" },
  { attr: "name", key: "twitter:image:alt" },
  { attr: "property", key: "og:type" },
  { attr: "property", key: "og:title" },
  { attr: "property", key: "og:description" },
  { attr: "property", key: "og:url" },
  { attr: "property", key: "og:image" },
  { attr: "property", key: "og:image:alt" },
  { attr: "property", key: "og:site_name" },
  { attr: "property", key: "og:locale" },
  { attr: "property", key: "article:published_time" },
];

export function applySeo(meta: SeoMeta): void {
  if (typeof document === "undefined") return;

  document.title = meta.title;

  const values = new Map<string, string>();
  const set = (attr: ManagedMeta["attr"], key: string, value: string): void => {
    values.set(`${attr}:${key}`, value);
  };

  set("name", "description", meta.description);
  set("name", "robots", meta.robots);
  set("name", "twitter:card", meta.image ? "summary_large_image" : "summary");
  if (TWITTER_SITE) set("name", "twitter:site", TWITTER_SITE);
  set("name", "twitter:title", meta.title);
  set("name", "twitter:description", meta.description);
  if (meta.image) {
    set("name", "twitter:image", meta.image);
    if (meta.imageAlt) set("name", "twitter:image:alt", meta.imageAlt);
  }

  set("property", "og:type", meta.ogType);
  set("property", "og:title", meta.title);
  set("property", "og:description", meta.description);
  set("property", "og:url", meta.canonical);
  set("property", "og:site_name", SITE_NAME);
  set("property", "og:locale", "zh_CN");
  if (meta.image) {
    set("property", "og:image", meta.image);
    if (meta.imageAlt) set("property", "og:image:alt", meta.imageAlt);
  }
  if (meta.publishedTime) set("property", "article:published_time", meta.publishedTime);

  for (const { attr, key } of MANAGED_META) {
    const selector = `meta[${attr}="${key}"]`;
    const existing = document.head.querySelector<HTMLMetaElement>(selector);
    const value = values.get(`${attr}:${key}`);

    if (!value) {
      existing?.remove();
      continue;
    }

    const element = existing ?? document.createElement("meta");
    if (!existing) {
      element.setAttribute(attr, key);
      document.head.appendChild(element);
    }
    element.setAttribute("content", value);
  }

  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.setAttribute("rel", "canonical");
    document.head.appendChild(canonical);
  }
  canonical.setAttribute("href", meta.canonical);

  const existingJsonLd = document.head.querySelector<HTMLScriptElement>("script[data-seo-jsonld]");
  if (meta.jsonLd.length === 0) {
    existingJsonLd?.remove();
    return;
  }

  const script = existingJsonLd ?? document.createElement("script");
  if (!existingJsonLd) {
    script.type = "application/ld+json";
    script.dataset.seoJsonld = "true";
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(
    meta.jsonLd.length === 1 ? meta.jsonLd[0] : meta.jsonLd,
  ).replace(/</g, "\\u003c");
}

export function useSeo(meta: SeoMeta | null): void {
  const key = meta ? JSON.stringify(meta) : "";

  useEffect(() => {
    if (!meta) return;
    applySeo(meta);
    // key 已经覆盖 meta 的全部字段；每次渲染的新对象不应重复写 DOM。
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
