#!/usr/bin/env bun
/**
 * 校验 generate-seo 的产物：sitemap 条数、robots、单场页的 canonical / title / OG。
 * CI 在 build 之后运行；失败即非零退出。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SITEMAP_SECTIONS } from "../src/lib/seo.ts";
import type { BatchManifest, DatasetIndex } from "../src/types/dataset.ts";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = join(appRoot, "dist");
const publicRoot = join(appRoot, "public");
const isCi = Boolean(process.env.CI);

const rawSite = (process.env.SITE_URL ?? process.env.VITE_SITE_URL ?? "").replace(/\/+$/, "");
const vercelHost = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").replace(/^https?:\/\//, "");
const site = rawSite || (vercelHost ? `https://${vercelHost}` : "");
const basePath = (process.env.VITE_BASE ?? "/").replace(/\/+$/, "");

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

if (!site) {
  if (isCi) {
    console.error("[verify-seo] 缺少 SITE_URL / VITE_SITE_URL");
    process.exit(1);
  }
  console.warn("[verify-seo] 缺少 SITE_URL / VITE_SITE_URL，跳过绝对地址相关检查");
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

const rootHtml = join(distRoot, "index.html");
if (!existsSync(rootHtml)) {
  failures.push("dist/index.html 不存在");
} else {
  const html = read(rootHtml);
  check(html.includes('type="module"'), "dist/index.html 缺少 app 的 module script");
  check(html.includes('rel="canonical"'), "dist/index.html 缺少 canonical");
  check(html.includes("<noscript>"), "dist/index.html 缺少 noscript 兜底内容");
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
  check(html.includes("<title>"), `${entry.id} 单场页缺少 <title>`);
  check(html.includes('rel="canonical"'), `${entry.id} 单场页缺少 canonical`);
  check(html.includes('property="og:image"'), `${entry.id} 单场页缺少 og:image`);
  check(html.includes('property="og:title"'), `${entry.id} 单场页缺少 og:title`);

  if (site) {
    const canonical = `${site}${basePath}/${entry.id}/stream/${sample.videoId}`;
    check(
      html.includes(`href="${canonical}"`),
      `${entry.id} 单场页 canonical 不是 ${canonical}`,
    );
  }
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
