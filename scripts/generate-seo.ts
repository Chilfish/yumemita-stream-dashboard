#!/usr/bin/env bun
/**
 * 为每个路由生成一份带 title / description / canonical / OG / JSON-LD 的静态 HTML，
 * 并输出 sitemap.xml 与 robots.txt。不用无头浏览器，纯字符串模板。
 *
 * 输入：dist/index.html（vite build 产物）+ public/data（sync:data 产物）。
 * 输出：dist/<path>/index.html、dist/sitemap.xml、dist/robots.txt。
 *
 * 用法：
 *   bun scripts/generate-seo.ts
 *   bun scripts/generate-seo.ts --max-streams 200   # 只预渲染每位成员最近 200 场
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSeo,
  buildSitemap,
  SITE_NAME,
  type SeoDataset,
  type SeoMeta,
  type SeoStream,
} from "../src/lib/seo.ts";
import type { GroupViewKey, ViewKey } from "../src/lib/routes.ts";
import type { StreamSummary, BatchManifest, DatasetIndex, DatasetIndexEntry } from "../src/types/dataset.ts";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = join(appRoot, "dist");
const publicRoot = join(appRoot, "public");
const templatePath = join(distRoot, "index.html");

const SEO_START = "<!--seo:start-->";
const SEO_END = "<!--seo:end-->";
const SEO_BODY = "<!--seo:body-->";

function fail(message: string): never {
  console.error(`[seo] ${message}`);
  process.exit(1);
}

function warn(message: string): void {
  console.warn(`[seo] ${message}`);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function parseMaxStreams(argv: string[]): number {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--max-streams") {
      const next = Number(argv[index + 1]);
      if (!Number.isInteger(next) || next <= 0) fail("--max-streams 需要一个正整数");
      return next;
    }
    if (arg.startsWith("--max-streams=")) {
      const next = Number(arg.slice("--max-streams=".length));
      if (!Number.isInteger(next) || next <= 0) fail("--max-streams 需要一个正整数");
      return next;
    }
  }
  return Number.POSITIVE_INFINITY;
}

const maxStreams = parseMaxStreams(process.argv.slice(2));
const isCi = Boolean(process.env.CI);

const rawSite = (process.env.SITE_URL ?? process.env.VITE_SITE_URL ?? "").replace(/\/+$/, "");
const vercelHost = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").replace(/^https?:\/\//, "");
const site = rawSite || (vercelHost ? `https://${vercelHost}` : "");
const basePath = (process.env.VITE_BASE ?? "/").replace(/\/+$/, "");

if (!site) {
  if (isCi) fail("缺少 SITE_URL / VITE_SITE_URL：CI 里必须给出站点根地址。");
  warn("缺少 SITE_URL / VITE_SITE_URL，canonical 与 sitemap 会使用相对地址。");
}

const dataBase = (process.env.VITE_DATAPACK_BASE ?? "").replace(/\/+$/, "");

function thumbUrl(datasetId: string, videoId: string): string {
  const path = `${datasetId}/thumbs/${encodeURIComponent(videoId)}.jpg`;
  return dataBase ? `${dataBase}/${path}` : `${site}${basePath}/data/${path}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sortByStart(streams: StreamSummary[]): StreamSummary[] {
  return [...streams].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}

function renderHead(meta: SeoMeta): string {
  const tags: string[] = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="robots" content="${meta.robots}" />`,
    `<link rel="canonical" href="${escapeHtml(meta.canonical)}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="zh_CN" />`,
    `<meta property="og:type" content="${meta.ogType}" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(meta.canonical)}" />`,
    `<meta name="twitter:card" content="${meta.image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
  ];

  if (meta.image) {
    tags.push(
      `<meta property="og:image" content="${escapeHtml(meta.image)}" />`,
      `<meta property="og:image:width" content="1280" />`,
      `<meta property="og:image:height" content="720" />`,
      `<meta name="twitter:image" content="${escapeHtml(meta.image)}" />`,
    );
  }

  if (meta.publishedTime) {
    tags.push(`<meta property="article:published_time" content="${escapeHtml(meta.publishedTime)}" />`);
  }

  for (const jsonLd of meta.jsonLd) {
    tags.push(
      `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`,
    );
  }

  return tags.join("\n    ");
}

function link(path: string, text: string): string {
  return `<a href="${escapeHtml(`${basePath}${path}`)}">${escapeHtml(text)}</a>`;
}

function streamList(streams: StreamSummary[], datasetId: string, limit = 10): string {
  if (streams.length === 0) return "";
  const items = streams
    .slice(0, limit)
    .map(stream => {
      const date = stream.startedAt ? stream.startedAt.slice(0, 10) : "";
      return `<li>${escapeHtml(date)} ${link(`/${datasetId}/stream/${stream.videoId}`, stream.title)}</li>`;
    })
    .join("\n        ");
  return `<ul>\n        ${items}\n      </ul>`;
}

function noscriptBlock(title: string, body: string): string {
  return `<noscript>
      <div style="max-width:48rem;margin:2rem auto;padding:0 1rem;font-family:system-ui,sans-serif;line-height:1.6">
        <h1>${escapeHtml(title)}</h1>
        ${body}
        <p style="color:#666">启用 JavaScript 以查看交互图表。</p>
      </div>
    </noscript>`;
}

type DatasetBundle = {
  entry: DatasetIndexEntry;
  manifest: BatchManifest;
  streams: StreamSummary[];
  latest: StreamSummary | null;
};

function loadDatasets(): DatasetBundle[] {
  const indexPath = join(publicRoot, "data", "index.json");
  if (!existsSync(indexPath)) fail("缺少 public/data/index.json，先运行 bun run sync:data");

  const index = readJson<DatasetIndex>(indexPath);
  const bundles: DatasetBundle[] = [];

  for (const entry of index.datasets ?? []) {
    const manifestPath = entry.manifest
      ? join(publicRoot, entry.manifest)
      : join(publicRoot, "data", entry.id, "manifest.json");

    if (!existsSync(manifestPath)) {
      warn(`${entry.id} 缺少 manifest（${manifestPath}），跳过`);
      continue;
    }

    const manifest = readJson<BatchManifest>(manifestPath);
    const streams = sortByStart(manifest.streams ?? []);
    if (streams.length === 0) {
      warn(`${entry.id} 的 manifest 没有 streams，跳过`);
      continue;
    }

    bundles.push({ entry, manifest, streams, latest: streams[0] ?? null });
  }

  if (bundles.length === 0) fail("没有可用的 dataset");
  return bundles;
}

type PageRoute = {
  path: string;
  section: ViewKey | GroupViewKey;
  dataset: SeoDataset | null;
  stream: SeoStream | null;
  streamCount: number | null;
  updatedAt: string | null;
  image: string | null;
  noscript: string;
};

function shape(stream: StreamSummary): SeoStream {
  return {
    videoId: stream.videoId,
    title: stream.title,
    startedAt: stream.startedAt,
    durationSec: stream.durationSec,
    avgConcurrent: stream.avgConcurrent,
    maxConcurrent: stream.maxConcurrent,
    chatTotal: stream.chatTotal,
    superchats: stream.superchats,
  };
}

function buildRoutes(bundles: DatasetBundle[]): PageRoute[] {
  const routes: PageRoute[] = [];
  const totalStreams = bundles.reduce((sum, bundle) => sum + bundle.streams.length, 0);
  const latestEntry = bundles
    .flatMap(bundle =>
      bundle.latest ? [{ stream: bundle.latest, datasetId: bundle.entry.id }] : [],
    )
    .sort((a, b) => (b.stream.startedAt ?? "").localeCompare(a.stream.startedAt ?? ""))[0];
  const latest = latestEntry?.stream ?? null;

  const groupImage = latestEntry ? thumbUrl(latestEntry.datasetId, latestEntry.stream.videoId) : null;

  routes.push({
    path: "/",
    section: "home",
    dataset: null,
    stream: null,
    streamCount: totalStreams,
    updatedAt: latest?.startedAt ?? null,
    image: groupImage,
    noscript: noscriptBlock(
      `${SITE_NAME} · 全组`,
      `<p>夢限大みゅーたいぷ 五位成员的直播数据台，共 ${bundles.length} 位成员。</p>
      <ul>
        ${bundles
          .map(
            bundle =>
              `<li>${link(`/${bundle.entry.id}`, `${bundle.entry.label}（${bundle.streams.length} 场）`)}</li>`,
          )
          .join("\n        ")}
      </ul>`,
    ),
  });

  routes.push({
    path: "/gallery",
    section: "gallery",
    dataset: null,
    stream: null,
    streamCount: totalStreams,
    updatedAt: latest?.startedAt ?? null,
    image: groupImage,
    noscript: noscriptBlock(
      "全组封面墙",
      `<p>跨成员的直播封面，按 JST 自然月分组。</p><p>${link("/", "回到全组首页")}</p>`,
    ),
  });

  for (const bundle of bundles) {
    const { entry, streams, latest: memberLatest } = bundle;
    const dataset: SeoDataset = { id: entry.id, label: entry.label, count: streams.length };
    const image = memberLatest ? thumbUrl(entry.id, memberLatest.videoId) : null;
    const updatedAt = memberLatest?.startedAt ?? bundle.manifest.generatedAt ?? null;

    const pages: { path: string; section: ViewKey; title: string; summary: string }[] = [
      {
        path: `/${entry.id}`,
        section: "home",
        title: `${entry.label} 直播数据`,
        summary: `共 ${streams.length} 场直播。`,
      },
      { path: `/${entry.id}/streams`, section: "streams", title: `${entry.label} 场次列表`, summary: "" },
      { path: `/${entry.id}/trends`, section: "trends", title: `${entry.label} 趋势与月度变化`, summary: "" },
      { path: `/${entry.id}/gallery`, section: "gallery", title: `${entry.label} 相册`, summary: "" },
      {
        path: `/${entry.id}/transcripts`,
        section: "transcripts",
        title: `${entry.label} 逐字稿`,
        summary: "",
      },
      { path: `/${entry.id}/compare`, section: "compare", title: "场次对比", summary: "" },
      { path: `/${entry.id}/about`, section: "about", title: "数据说明", summary: "" },
    ];

    for (const page of pages) {
      const isHome = page.section === "home";
      const noscriptBody = isHome
        ? `<p>${escapeHtml(page.summary)}</p>
      ${streamList(streams, entry.id)}
      <p>${link(`/${entry.id}/streams`, "全部场次")} · ${link("/", "全组首页")}</p>`
        : `<p>${escapeHtml(page.title)}。${escapeHtml(page.summary)}</p>
      <p>${link(`/${entry.id}`, `回到 ${entry.label}`)} · ${link("/", "全组首页")}</p>`;

      routes.push({
        path: page.path,
        section: page.section,
        dataset,
        stream: null,
        streamCount: streams.length,
        updatedAt,
        image,
        noscript: noscriptBlock(`${entry.label} · ${page.title}`, noscriptBody),
      });
    }

    for (const stream of streams.slice(0, maxStreams === Infinity ? streams.length : maxStreams)) {
      const metrics = [
        stream.avgConcurrent != null ? `平均同接 ${stream.avgConcurrent}` : "",
        stream.maxConcurrent != null ? `峰值 ${stream.maxConcurrent}` : "",
        `弹幕 ${stream.chatTotal ?? 0} 条`,
        `SC ${stream.superchats ?? 0} 笔`,
      ].filter(Boolean);

      routes.push({
        path: `/${entry.id}/stream/${stream.videoId}`,
        section: "stream",
        dataset,
        stream: shape(stream),
        streamCount: streams.length,
        updatedAt,
        image: thumbUrl(entry.id, stream.videoId),
        noscript: noscriptBlock(
          `${stream.title} · ${entry.label}`,
          `<p>${escapeHtml(metrics.join(" · "))}</p>
      <p>${link(`/${entry.id}/streams`, `回到 ${entry.label} 的场次列表`)} · <a href="${escapeHtml(stream.url)}">在 YouTube 打开</a></p>`,
        ),
      });
    }
  }

  return routes;
}

function main(): void {
  if (!existsSync(templatePath)) fail("dist/index.html 不存在，先运行 vite build");
  const template = readFileSync(templatePath, "utf8");

  if (!template.includes(SEO_START) || !template.includes(SEO_END) || !template.includes(SEO_BODY)) {
    fail("index.html 缺少 <!--seo:start--> / <!--seo:end--> / <!--seo:body--> 标记");
  }

  const bundles = loadDatasets();
  const routes = buildRoutes(bundles);
  let written = 0;

  for (const route of routes) {
    const meta = buildSeo({
      origin: site,
      basePath,
      pathname: route.path,
      section: route.section,
      dataset: route.dataset,
      stream: route.stream,
      streamCount: route.streamCount,
      memberCount: bundles.length,
      updatedAt: route.updatedAt,
      image: route.image,
    });

    const headStart = template.indexOf(SEO_START);
    const headEnd = template.indexOf(SEO_END);
    const html = `${template.slice(0, headStart + SEO_START.length)}
    ${renderHead(meta)}
    ${template.slice(headEnd)}`.replace(SEO_BODY, route.noscript);

    if (route.path === "/") {
      writeFileSync(templatePath, html);
    } else {
      const dir = join(distRoot, ...route.path.split("/").filter(Boolean));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "index.html"), html);
    }
    written += 1;
  }

  const sitemapDatasets = bundles.map(bundle => ({
    id: bundle.entry.id,
    updatedAt: bundle.manifest.generatedAt ?? bundle.latest?.startedAt ?? null,
    streams: bundle.streams
      .slice(0, maxStreams === Infinity ? bundle.streams.length : maxStreams)
      .map(stream => ({ videoId: stream.videoId, startedAt: stream.startedAt })),
  }));

  if (site) {
    writeFileSync(join(distRoot, "sitemap.xml"), buildSitemap(site, basePath, sitemapDatasets));
    writeFileSync(
      join(distRoot, "robots.txt"),
      `User-agent: *\nAllow: /\n\nSitemap: ${site}${basePath}/sitemap.xml\n`,
    );
  } else {
    warn("没有站点根地址，跳过 sitemap.xml / robots.txt");
  }

  const streamCount = routes.filter(route => route.section === "stream").length;
  console.log(
    `[seo] 生成 ${written} 个页面（${streamCount} 个单场）${site ? `，sitemap 与 robots 已写入 ${distRoot}` : ""}`,
  );
}

main();
