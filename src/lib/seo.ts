import type { GroupViewKey, ViewKey } from "@/lib/routes";

/**
 * 每页的 title / description / canonical / OG 由这里统一生成。
 * 纯函数：不读 `import.meta.env`、不碰 DOM，客户端与构建脚本共用。
 */

export const SITE_NAME = "ゆめみた 配信数据台";
export const SITE_DESCRIPTION =
  "夢限大みゅーたいぷ 成员直播数据的可视化数据台：同接、弹幕、SC、评论与词频。";

const GROUP_NAME = "夢限大みゅーたいぷ";
const MAX_TITLE_CHARS = 44;
const MAX_DESCRIPTION_CHARS = 150;

/** sitemap 收录的成员栏目（`compare` 是 noindex，不进去）。 */
export const SITEMAP_SECTIONS = [
  "streams",
  "trends",
  "gallery",
  "transcripts",
  "about",
] as const;

export type SeoDataset = {
  id: string;
  label: string;
  count?: number | null;
};

export type SeoStream = {
  videoId: string;
  title: string;
  startedAt: string | null;
  durationSec?: number | null;
  avgConcurrent?: number | null;
  maxConcurrent?: number | null;
  chatTotal?: number | null;
  superchats?: number | null;
};

export type SeoContext = {
  /** 站点根地址，无尾斜杠。 */
  origin: string;
  /** 子路径部署的 base，`""` 或 `/dashboard`。 */
  basePath: string;
  /** 当前路径，用来拼 canonical；query 会被丢掉。 */
  pathname: string;
  section: ViewKey | GroupViewKey;
  dataset?: SeoDataset | null;
  stream?: SeoStream | null;
  /** 当前 dataset 或全组的场次数。 */
  streamCount?: number | null;
  memberCount?: number | null;
  /** 最近一次更新（通常是最新一场的开始时间）。 */
  updatedAt?: string | null;
  /** 绝对地址的分享图。 */
  image?: string | null;
  notFound?: boolean;
  error?: boolean;
};

export type RobotsDirective = "index,follow" | "noindex,follow";

export type SeoMeta = {
  title: string;
  description: string;
  canonical: string;
  image: string | null;
  robots: RobotsDirective;
  ogType: "website" | "article";
  publishedTime: string | null;
  jsonLd: Record<string, unknown>[];
};

export type SitemapStream = {
  videoId: string;
  startedAt: string | null;
};

export type SitemapDataset = {
  id: string;
  updatedAt?: string | null;
  streams: SitemapStream[];
};

const numberFormat = new Intl.NumberFormat("zh-CN");
const uiDate = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const isoDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function truncateText(value: string, max = MAX_TITLE_CHARS): string {
  const chars = Array.from(value.trim());
  if (chars.length <= max) return chars.join("");
  return `${chars.slice(0, Math.max(1, max - 1)).join("")}…`;
}

/** 去掉 query / hash / 重复斜杠与末尾斜杠；根路径统一成 `/`。 */
export function normalizePath(pathname: string): string {
  let path = pathname.trim();
  const hashIndex = path.indexOf("#");
  if (hashIndex >= 0) path = path.slice(0, hashIndex);
  const queryIndex = path.indexOf("?");
  if (queryIndex >= 0) path = path.slice(0, queryIndex);
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path || "/";
}

export function absoluteUrl(origin: string, basePath: string, pathname: string): string {
  const base = basePath.replace(/\/+$/, "");
  const path = normalizePath(pathname);
  return `${origin.replace(/\/+$/, "")}${base}${path}`;
}

function formatNumber(value: number): string {
  return numberFormat.format(value);
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return uiDate.format(date);
}

/** sitemap 用的 `YYYY-MM-DD`（JST）。 */
export function isoDateKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return isoDate.format(date);
}

function clampDescription(value: string): string {
  return truncateText(value, MAX_DESCRIPTION_CHARS);
}

function countLabel(count: number | null | undefined): string | null {
  return typeof count === "number" ? formatNumber(count) : null;
}

function streamDescription(stream: SeoStream, label: string, date: string | null): string {
  const stats: string[] = [];
  if (stream.avgConcurrent != null) stats.push(`平均同接 ${formatNumber(stream.avgConcurrent)}`);
  if (stream.maxConcurrent != null) stats.push(`峰值 ${formatNumber(stream.maxConcurrent)}`);
  if (stream.chatTotal != null) stats.push(`弹幕 ${formatNumber(stream.chatTotal)} 条`);
  if (stream.superchats != null) stats.push(`SC ${formatNumber(stream.superchats)} 笔`);

  const title = truncateText(stream.title, 30);
  const when = [label, date].filter(Boolean).join(" ");
  const detail = stats.length > 0 ? stats.join(" · ") : "同接、弹幕密度、SC 与逐分钟节奏";
  return clampDescription(`${when}「${title}」：${detail}。`);
}

function sectionCopy(
  section: ViewKey | GroupViewKey,
  dataset: SeoDataset,
  streamCount: number | null | undefined,
): { title: string; description: string } {
  const label = dataset.label;
  const count = countLabel(streamCount ?? dataset.count);
  const suffix = count ? `（共 ${count} 场）` : "";

  switch (section) {
    case "streams":
      return {
        title: `${label} 场次列表 | ${SITE_NAME}`,
        description: clampDescription(
          `${label} 的直播场次${suffix}：按日期、内容类型与同接筛选，支持排序与 CSV 导出。`,
        ),
      };
    case "trends":
      return {
        title: `${label} 趋势与月度变化 | ${SITE_NAME}`,
        description: clampDescription(
          `${label} 的月度趋势与内容类型对比：场次频率、弹幕密度、SC 与平均同接。`,
        ),
      };
    case "gallery":
      return {
        title: `${label} 相册 | ${SITE_NAME}`,
        description: clampDescription(`${label} 的直播封面墙，按 JST 自然月分组。`),
      };
    case "transcripts":
      return {
        title: `${label} 逐字稿 | ${SITE_NAME}`,
        description: clampDescription(
          `${label} 的直播逐字稿索引，支持目录与时间戳跳转 YouTube。`,
        ),
      };
    case "compare":
      return {
        title: `场次对比 | ${SITE_NAME}`,
        description: "选择最多 4 场直播，叠加逐分钟弹幕并横向对比同接、弹幕与 SC。",
      };
    case "about":
      return {
        title: `数据说明 | ${SITE_NAME}`,
        description: "数据来源、统计口径、已知限制与更新方式。",
      };
    case "stream":
      return {
        title: `单场数据 | ${label} | ${SITE_NAME}`,
        description: clampDescription(`${label} 单场直播的同接、弹幕、SC 与评论数据。`),
      };
    default:
      return {
        title: `${label} 直播数据 | ${SITE_NAME}`,
        description: clampDescription(
          `${label} 的直播数据${suffix}：平均/最大同接、弹幕密度、SC、评论与逐字稿。`,
        ),
      };
  }
}

function breadcrumbList(
  origin: string,
  basePath: string,
  items: { name: string; path: string }[],
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(origin, basePath, item.path),
    })),
  };
}

function websiteJsonLd(origin: string, basePath: string, description: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    alternateName: GROUP_NAME,
    url: absoluteUrl(origin, basePath, "/"),
    inLanguage: "zh-CN",
    description,
  };
}

export function buildSeo(ctx: SeoContext): SeoMeta {
  const canonical = absoluteUrl(ctx.origin, ctx.basePath, ctx.pathname);
  const image = ctx.image ?? null;
  const robots: RobotsDirective =
    ctx.notFound || ctx.error || ctx.section === "compare" ? "noindex,follow" : "index,follow";

  if (ctx.error) {
    return {
      title: `页面出错了 | ${SITE_NAME}`,
      description: "页面出了点问题，可以重试一次，或者回到首页继续浏览。",
      canonical,
      image: null,
      robots: "noindex,follow",
      ogType: "website",
      publishedTime: null,
      jsonLd: [],
    };
  }

  if (!ctx.dataset) {
    if (ctx.section === "gallery") {
      return {
        title: `全组封面墙 | ${SITE_NAME}`,
        description: `夢限大みゅーたいぷ 五位成员的直播封面，按 JST 自然月排列，可按成员与内容类型筛选。`,
        canonical,
        image,
        robots,
        ogType: "website",
        publishedTime: null,
        jsonLd: [
          breadcrumbList(ctx.origin, ctx.basePath, [
            { name: GROUP_NAME, path: "/" },
            { name: "全组封面墙", path: "/gallery" },
          ]),
        ],
      };
    }

    const members = countLabel(ctx.memberCount);
    const streams = countLabel(ctx.streamCount);
    const description = clampDescription(
      [
        `${GROUP_NAME}${members ? ` ${members} 位成员` : ""}${streams ? `、${streams} 场直播` : ""}的数据台`,
        "同接、弹幕、SC、评论与逐字稿。",
      ].join("："),
    );

    return {
      title: `${GROUP_NAME} 直播数据 | ${SITE_NAME}`,
      description,
      canonical,
      image,
      robots,
      ogType: "website",
      publishedTime: null,
      jsonLd: [websiteJsonLd(ctx.origin, ctx.basePath, description)],
    };
  }

  const dataset = ctx.dataset;

  if (ctx.section === "stream") {
    if (!ctx.stream) {
      return {
        title: `找不到这场直播 | ${SITE_NAME}`,
        description: "这场直播不存在，可能已被删除，或从未被本站收录。",
        canonical,
        image,
        robots: "noindex,follow",
        ogType: "website",
        publishedTime: null,
        jsonLd: [],
      };
    }

    const stream = ctx.stream;
    const date = formatDate(stream.startedAt);
    const description = streamDescription(stream, dataset.label, date);
    const title = `${truncateText(stream.title, 40)} · ${dataset.label} | ${SITE_NAME}`;

    return {
      title,
      description,
      canonical,
      image,
      robots,
      ogType: "article",
      publishedTime: stream.startedAt,
      jsonLd: [
        breadcrumbList(ctx.origin, ctx.basePath, [
          { name: GROUP_NAME, path: "/" },
          { name: dataset.label, path: `/${dataset.id}` },
          { name: "场次", path: `/${dataset.id}/streams` },
          { name: truncateText(stream.title, 40), path: `/${dataset.id}/stream/${stream.videoId}` },
        ]),
        {
          "@context": "https://schema.org",
          "@type": "WebPage",
          url: canonical,
          name: title,
          description,
          inLanguage: "zh-CN",
          ...(stream.startedAt ? { datePublished: stream.startedAt } : {}),
          isPartOf: {
            "@type": "WebSite",
            name: SITE_NAME,
            url: absoluteUrl(ctx.origin, ctx.basePath, "/"),
          },
        },
      ],
    };
  }

  const copy = sectionCopy(ctx.section, dataset, ctx.streamCount);
  const updated = formatDate(ctx.updatedAt);
  const description =
    ctx.section === "home" && updated ? `${copy.description}数据更新至 ${updated}。` : copy.description;

  const breadcrumb: { name: string; path: string }[] = [
    { name: GROUP_NAME, path: "/" },
    { name: dataset.label, path: `/${dataset.id}` },
  ];
  const sectionNames: Partial<Record<ViewKey | GroupViewKey, string>> = {
    streams: "场次",
    trends: "趋势",
    gallery: "相册",
    transcripts: "逐字稿",
    compare: "对比",
    about: "说明",
  };
  const sectionName = sectionNames[ctx.section];
  if (sectionName) breadcrumb.push({ name: sectionName, path: `/${dataset.id}/${ctx.section}` });

  return {
    title: copy.title,
    description: clampDescription(description),
    canonical,
    image,
    robots,
    ogType: "website",
    publishedTime: null,
    jsonLd: [breadcrumbList(ctx.origin, ctx.basePath, breadcrumb)],
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildSitemap(
  origin: string,
  basePath: string,
  datasets: SitemapDataset[],
): string {
  const entries: { loc: string; lastmod: string | null }[] = [];
  const latestUpdate = datasets
    .map(dataset => dataset.updatedAt ?? dataset.streams[0]?.startedAt ?? null)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  for (const path of ["/", "/gallery"]) {
    entries.push({ loc: absoluteUrl(origin, basePath, path), lastmod: isoDateKey(latestUpdate) });
  }

  for (const dataset of datasets) {
    const lastmod = isoDateKey(dataset.updatedAt);
    for (const path of [`/${dataset.id}`, ...SITEMAP_SECTIONS.map(section => `/${dataset.id}/${section}`)]) {
      entries.push({ loc: absoluteUrl(origin, basePath, path), lastmod });
    }
    for (const stream of dataset.streams) {
      entries.push({
        loc: absoluteUrl(origin, basePath, `/${dataset.id}/stream/${stream.videoId}`),
        lastmod: isoDateKey(stream.startedAt),
      });
    }
  }

  const urls = entries
    .map(entry =>
      entry.lastmod
        ? `<url><loc>${escapeXml(entry.loc)}</loc><lastmod>${entry.lastmod}</lastmod></url>`
        : `<url><loc>${escapeXml(entry.loc)}</loc></url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
