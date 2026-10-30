import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  buildSeo,
  buildSitemap,
  isoDateKey,
  normalizePath,
  SITE_NAME,
  truncateText,
  type SeoContext,
} from "./seo";

const origin = "https://example.com";
const basePath = "/dashboard";

function build(overrides: Partial<SeoContext>): ReturnType<typeof buildSeo> {
  return buildSeo({
    origin,
    basePath,
    pathname: "/",
    section: "home",
    dataset: null,
    ...overrides,
  });
}

const dataset = { id: "nonoka", label: "宮永ののか", count: 287 };

describe("URL 拼接", () => {
  it("根路径与子路径", () => {
    expect(absoluteUrl(origin, "", "/")).toBe("https://example.com/");
    expect(absoluteUrl(origin, "/dashboard", "/")).toBe("https://example.com/dashboard/");
    expect(absoluteUrl(origin, "/dashboard/", "/nonoka")).toBe(
      "https://example.com/dashboard/nonoka",
    );
  });

  it("canonical 丢弃 query、hash、重复与末尾斜杠", () => {
    expect(normalizePath("/nonoka/stream/abc?view=timeline")).toBe("/nonoka/stream/abc");
    expect(normalizePath("/nonoka//trends/#x")).toBe("/nonoka/trends");
    expect(normalizePath("/")).toBe("/");
  });

  it("标题截断保留省略号", () => {
    expect(truncateText("abcdef", 4)).toBe("abc…");
    expect(truncateText("abc", 4)).toBe("abc");
  });
});

describe("组级页面", () => {
  it("首页是 WebSite 结构化数据", () => {
    const meta = build({ memberCount: 5, streamCount: 1891, updatedAt: "2026-10-29T12:00:00Z" });
    expect(meta.title).toContain("夢限大みゅーたいぷ");
    expect(meta.description).toContain("5 位成员");
    expect(meta.description).toContain("1,891 场直播");
    expect(meta.canonical).toBe("https://example.com/dashboard/");
    expect(meta.robots).toBe("index,follow");
    expect(meta.jsonLd[0]?.["@type"]).toBe("WebSite");
  });

  it("全组相册有自己的标题", () => {
    const meta = build({ section: "gallery", pathname: "/gallery" });
    expect(meta.title).toContain("全组封面墙");
    expect(meta.canonical).toBe("https://example.com/dashboard/gallery");
    expect(meta.jsonLd[0]?.["@type"]).toBe("BreadcrumbList");
  });

  it("未知路径归一到首页并且不收录", () => {
    const meta = build({ section: "home", pathname: "/", notFound: true });
    expect(meta.robots).toBe("noindex,follow");
    expect(meta.canonical).toBe("https://example.com/dashboard/");
  });
});

describe("成员页面", () => {
  it("首页带场次数与更新日期", () => {
    const meta = build({
      dataset,
      pathname: "/nonoka",
      streamCount: 287,
      updatedAt: "2026-10-29T12:00:00Z",
    });
    expect(meta.title).toBe(`宮永ののか 直播数据 | ${SITE_NAME}`);
    expect(meta.description).toContain("287");
    expect(meta.description).toContain("2026/10/29");
    expect(meta.canonical).toBe("https://example.com/dashboard/nonoka");
    expect(meta.robots).toBe("index,follow");
  });

  it("各栏目标题互不相同", () => {
    const sections = ["streams", "trends", "gallery", "transcripts", "about"] as const;
    const titles = sections.map(section =>
      build({ dataset, pathname: `/nonoka/${section}`, section }).title,
    );
    expect(new Set(titles).size).toBe(sections.length);
    expect(titles[0]).toContain("场次列表");
  });

  it("对比页不收录", () => {
    const meta = build({ dataset, pathname: "/nonoka/compare", section: "compare" });
    expect(meta.robots).toBe("noindex,follow");
  });
});

describe("单场页", () => {
  const stream = {
    videoId: "abc123",
    title: "【歌枠】深夜に歌う",
    startedAt: "2026-10-29T13:00:00Z",
    durationSec: 7200,
    avgConcurrent: 1234,
    maxConcurrent: 2345,
    chatTotal: 12345,
    superchats: 23,
  };

  it("标题、描述、分享图与 article 类型", () => {
    const meta = build({
      dataset,
      pathname: "/nonoka/stream/abc123",
      section: "stream",
      stream,
      image: "https://cdn.example.com/nonoka/thumbs/abc123.jpg",
    });

    expect(meta.title).toBe(`【歌枠】深夜に歌う · 宮永ののか | ${SITE_NAME}`);
    expect(meta.description).toContain("平均同接 1,234");
    expect(meta.description).toContain("峰值 2,345");
    expect(meta.description).toContain("弹幕 12,345 条");
    expect(meta.description).toContain("SC 23 笔");
    expect(meta.canonical).toBe("https://example.com/dashboard/nonoka/stream/abc123");
    expect(meta.ogType).toBe("article");
    expect(meta.publishedTime).toBe(stream.startedAt);
    expect(meta.image).toBe("https://cdn.example.com/nonoka/thumbs/abc123.jpg");
    expect(meta.imageAlt).toContain("宮永ののか");
    expect(meta.jsonLd.map(item => item["@type"])).toEqual([
      "BreadcrumbList",
      "VideoObject",
      "WebPage",
    ]);

    const video = meta.jsonLd.find(item => item["@type"] === "VideoObject");
    expect(video?.duration).toBe("PT2H");
    expect(video?.embedUrl).toContain("/embed/abc123");
    expect(video?.thumbnailUrl).toEqual(["https://cdn.example.com/nonoka/thumbs/abc123.jpg"]);
  });

  it("没有分享图时不写 imageAlt", () => {
    const meta = build({
      dataset,
      pathname: "/nonoka/stream/abc123",
      section: "stream",
      stream,
    });
    expect(meta.image).toBeNull();
    expect(meta.imageAlt).toBeNull();
  });

  it("长标题在 title 里截断", () => {
    const meta = build({
      dataset,
      pathname: "/nonoka/stream/abc123",
      section: "stream",
      stream: { ...stream, title: "あ".repeat(80) },
    });
    expect(meta.title.startsWith("あ".repeat(39))).toBe(true);
    expect(meta.title).toContain("…");
  });

  it("缺少指标时不出现占位符", () => {
    const meta = build({
      dataset,
      pathname: "/nonoka/stream/abc123",
      section: "stream",
      stream: { ...stream, avgConcurrent: null, maxConcurrent: null, chatTotal: null, superchats: null },
    });
    expect(meta.description).not.toContain("—");
    expect(meta.description).toContain("逐分钟节奏");
  });

  it("不存在的单场不收录", () => {
    const meta = build({
      dataset,
      pathname: "/nonoka",
      section: "stream",
      stream: null,
      notFound: true,
    });
    expect(meta.title).toContain("找不到这场直播");
    expect(meta.robots).toBe("noindex,follow");
    expect(meta.jsonLd).toEqual([]);
  });
});

describe("错误页", () => {
  it("noindex 且不留结构化数据", () => {
    const meta = build({ error: true, pathname: "/" });
    expect(meta.title).toContain("页面出错了");
    expect(meta.robots).toBe("noindex,follow");
    expect(meta.jsonLd).toEqual([]);
  });
});

describe("sitemap", () => {
  it("包含组页、栏目页与单场页，不带 query", () => {
    const xml = buildSitemap(origin, basePath, [
      {
        id: "nonoka",
        updatedAt: "2026-10-30T00:00:00Z",
        streams: [{ videoId: "a&b", startedAt: "2026-10-29T13:00:00Z" }],
      },
    ]);

    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
    expect(locs).toHaveLength(9);
    expect(locs).toContain("https://example.com/dashboard/nonoka/trends");
    expect(locs).toContain("https://example.com/dashboard/nonoka/stream/a&amp;b");
    expect(locs.every(loc => !loc.includes("?"))).toBe(true);
    expect(xml).toContain("<lastmod>2026-10-29</lastmod>");
  });

  it("lastmod 使用 JST 日期", () => {
    expect(isoDateKey("2026-10-29T16:00:00Z")).toBe("2026-10-30");
    expect(isoDateKey(null)).toBeNull();
  });
});
