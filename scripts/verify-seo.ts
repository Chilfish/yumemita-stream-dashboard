#!/usr/bin/env bun
/**
 * 校验 generate-seo 的产物：sitemap 条数、robots、单场页的 canonical / title / OG。
 * CI 在 build 之后运行；失败即非零退出。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { DEFAULT_SITE_URL, SITEMAP_SECTIONS } from "../src/lib/seo.ts";
import type { BatchManifest, DatasetIndex } from "../src/types/dataset.ts";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = join(appRoot, "dist");
const publicRoot = join(appRoot, "public");

const env = { ...loadEnv("production", appRoot, ""), ...process.env } as Record<
  string,
  string | undefined
>;
const site = (env.SITE_URL ?? env.VITE_SITE_URL ?? "").replace(/\/+$/, "") || DEFAULT_SITE_URL;
const basePath = (env.VITE_BASE ?? "/").replace(/\/+$/, "");
const dataBase = (env.VITE_DATAPACK_BASE ?? "").replace(/\/+$/, "");

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function metaContent(html: string, attr: "name" | "property", key: string): string {
  const match = html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`));
  return match?.[1] ?? "";
}

const indexPath = join(publicRoot, "data", "index.json");
if (!existsSync(indexPath)) {
  console.error("[verify-seo] 缺少 public/data/index.json，先运行 bun run sync:data");
  process.exit(1);
}

const index = JSON.parse(read(indexPath)) as DatasetIndex;
const bundles: { entry: (typeof index.datasets)[number]; manifest: BatchManifest }[] = [];

for (const entry of index.datasets ?? []) {
  const manifestPath = entry.manifest
    ? join(publicRoot, entry.manifest)
    : join(publicRoot, "data", entry.id, "manifest.json");
  if (!existsSync(manifestPath)) {
    failures.push(`${entry.id} 缺少 manifest`);
    continue;
  }
  bundles.push({ entry, manifest: JSON.parse(read(manifestPath)) as BatchManifest });
}

const totalStreams = bundles.reduce((sum, bundle) => sum + bundle.manifest.streams.length, 0);
const expectedSitemapUrls = 2 + bundles.length * (1 + SITEMAP_SECTIONS.length) + totalStreams;

const sitemapPath = join(distRoot, "sitemap.xml");
check(existsSync(sitemapPath), "dist/sitemap.xml 不存在");

if (existsSync(sitemapPath)) {
  const sitemap = read(sitemapPath);
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  check(
    locs.length === expectedSitemapUrls,
    `sitemap 有 ${locs.length} 条 URL，期望 ${expectedSitemapUrls}`,
  );
  check(
    locs.every(loc => !loc.includes("?")),
    "sitemap 里不应出现 query 参数",
  );

  if (site) {
    const prefix = `${site}${basePath}/`;
    const outside = locs.find(loc => !loc.startsWith(prefix));
    check(!outside, `sitemap 里出现了站点外的地址：${outside ?? ""}`);
  }
}

const robotsPath = join(distRoot, "robots.txt");
check(existsSync(robotsPath), "dist/robots.txt 不存在");
if (existsSync(robotsPath) && site) {
  const robots = read(robotsPath);
  check(
    robots.includes(`Sitemap: ${site}${basePath}/sitemap.xml`),
    "robots.txt 没有指向 sitemap.xml",
  );
}

for (const asset of [
  "apple-touch-icon.png",
  "favicon-32x32.png",
  "site.webmanifest",
  "favicon.svg",
]) {
  check(existsSync(join(distRoot, asset)), `dist/${asset} 不存在`);
}

const rootHtml = join(distRoot, "index.html");
if (!existsSync(rootHtml)) {
  failures.push("dist/index.html 不存在");
} else {
  const html = read(rootHtml);
  check(html.includes('type="module"'), "dist/index.html 缺少 app 的 module script");
  check(html.includes('rel="canonical"'), "dist/index.html 缺少 canonical");
  check(html.includes("<noscript>"), "dist/index.html 缺少 noscript 兜底内容");
  const h1Count = (html.match(/<h1\b/g) ?? []).length;
  check(h1Count === 1, `dist/index.html 应有 1 个 H1（实际 ${h1Count}）`);
  check(!html.includes("<!--seo:body-->"), "dist/index.html 仍是未生成 SEO 的模板");
  check(!html.includes("__SITE_URL__"), "dist/index.html 没有替换 __SITE_URL__");

  for (const [attr, key] of [
    ["property", "og:image"],
    ["property", "og:url"],
    ["property", "og:title"],
    ["name", "twitter:image"],
    ["name", "twitter:site"],
  ] as const) {
    check(metaContent(html, attr, key) !== "", `dist/index.html 缺少 ${key}`);
  }
  check(html.includes('type="application/ld+json"'), "dist/index.html 缺少 JSON-LD");
}

function streamPagePath(datasetId: string, videoId: string): string {
  return join(distRoot, datasetId, "stream", videoId, "index.html");
}

for (const bundle of bundles) {
  const { entry } = bundle;
  const streams = bundle.manifest.streams;
  check(streams.length > 0, `${entry.id} 的 manifest 没有 streams`);
  if (streams.length === 0) continue;

  for (const stream of streams) {
    if (!existsSync(streamPagePath(entry.id, stream.videoId))) {
      failures.push(`缺少单场页：${entry.id}/stream/${stream.videoId}`);
      break;
    }
  }

  const sample = streams[0];
  const pagePath = streamPagePath(entry.id, sample.videoId);
  if (!existsSync(pagePath)) continue;

  const html = read(pagePath);
  const label = `${entry.id}/stream/${sample.videoId}`;
  check(html.includes("<title>"), `${label} 缺少 <title>`);
  check(html.includes('rel="canonical"'), `${label} 缺少 canonical`);
  const h1Count = (html.match(/<h1\b/g) ?? []).length;
  check(h1Count === 1, `${label} 应有 1 个 H1（实际 ${h1Count}）`);
  check(!html.includes("<!--seo:body-->"), `${label} 仍是未生成 SEO 的模板`);
  check(html.includes('type="application/ld+json"'), `${label} 缺少 JSON-LD`);
  check(html.includes('"@type":"VideoObject"'), `${label} 缺少 VideoObject`);

  for (const [attr, key] of [
    ["property", "og:title"],
    ["property", "og:description"],
    ["property", "og:url"],
    ["property", "og:image"],
    ["property", "og:image:alt"],
    ["name", "twitter:card"],
    ["name", "twitter:image"],
    ["name", "twitter:image:alt"],
  ] as const) {
    check(metaContent(html, attr, key) !== "", `${label} 缺少 ${key}`);
  }

  const canonical = `${site}${basePath}/${entry.id}/stream/${sample.videoId}`;
  check(
    html.includes(`href="${canonical}"`),
    `${label} canonical 不是 ${canonical}`,
  );
  check(
    metaContent(html, "property", "og:url") === canonical,
    `${label} og:url 不是 ${canonical}`,
  );

  const image = metaContent(html, "property", "og:image");
  check(/^https?:\/\//.test(image), `${label} og:image 不是绝对地址`);
  if (dataBase) {
    check(image.startsWith(`${dataBase}/`), `${label} og:image 不在数据源上：${image}`);
  }

  const description = metaContent(html, "property", "og:description");
  check(Array.from(description).length >= 50, `${label} 的 description 太短`);
}

if (failures.length > 0) {
  console.error(`[verify-seo] ${failures.length} 项失败`);
  for (const failure of failures.slice(0, 20)) console.error(`  ✗ ${failure}`);
  if (failures.length > 20) console.error(`  … 其余 ${failures.length - 20} 项省略`);
  process.exit(1);
}

console.log(
  `[verify-seo] 通过：${bundles.length} 个成员、${totalStreams} 个单场页、sitemap ${expectedSitemapUrls} 条 URL`,
);
