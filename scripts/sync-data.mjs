#!/usr/bin/env node
/**
 * 把 manifest / insights 同步到 public/data/，供页面同源加载。
 *
 * 真源在对象存储（R2）：<base>/<id>/manifest.json + insights.json + <videoId>.datapack.json
 *
 * - 配了 DATAPACK_BASE / VITE_DATAPACK_BASE：从远端拉 manifest 与 insights（带本地缓存），
 *   datapack 由浏览器直接向远端请求，不进构建产物。
 * - 没配：回退到本地 data/<id>/（由 publish:data 生成），连同 datapack 一起复制，离线可用。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(appRoot, "data-sources.json");
const outputRoot = join(appRoot, "public", "data");
const cacheRoot = join(appRoot, "node_modules", ".cache", "stream-dashboard");
const remoteBase = (process.env.DATAPACK_BASE ?? process.env.VITE_DATAPACK_BASE ?? "").replace(/\/+$/, "");

const INDEX_SCHEMA = "yumemita.dashboard.datasets/v1";

function fail(message) {
  console.error(`[sync-data] ${message}`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

async function fetchJson(url, cachePath) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, text, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (!existsSync(cachePath)) {
      throw new Error(`${url} 拉取失败，且没有本地缓存：${describe(error)}`);
    }
    console.warn(`[sync-data]   ! ${url} 拉取失败（${describe(error)}），使用本地缓存`);
    return readJson(cachePath);
  }
}

const config = readJson(configPath);
if (!Array.isArray(config.datasets) || config.datasets.length === 0) {
  fail("data-sources.json 里没有 datasets");
}

mkdirSync(outputRoot, { recursive: true });

const index = {
  schema: INDEX_SCHEMA,
  generatedAt: new Date().toISOString(),
  datasets: [],
};

for (const source of config.datasets) {
  const { id, label, color, channelId, datapackDir } = source;
  if (!id || !/^[a-z0-9-]+$/.test(id)) fail(`dataset id 非法：${id}`);
  if (!label) fail(`dataset ${id} 缺少 label`);
  if (!datapackDir) fail(`dataset ${id} 缺少 datapackDir`);

  const destDir = join(outputRoot, id);
  mkdirSync(destDir, { recursive: true });

  let manifest;
  let insights;
  let packCount = 0;

  if (remoteBase) {
    manifest = await fetchJson(
      `${remoteBase}/${id}/manifest.json`,
      join(cacheRoot, id, "manifest.json"),
    );
    insights = await fetchJson(
      `${remoteBase}/${id}/insights.json`,
      join(cacheRoot, id, "insights.json"),
    );
    // datapack 由浏览器直接向远端请求，产物里不留旧副本。
    for (const name of readdirSync(destDir)) {
      if (name.endsWith(".datapack.json")) rmSync(join(destDir, name));
    }
  } else {
    const stagingDir = resolve(appRoot, datapackDir);
    const manifestPath = join(stagingDir, "manifest.json");
    const insightsPath = join(stagingDir, "insights.json");
    if (!existsSync(manifestPath) || !existsSync(insightsPath)) {
      fail(`${id} 缺少本地 ${datapackDir}/manifest.json 或 insights.json；先运行 bun run publish:data --no-upload`);
    }
    manifest = readJson(manifestPath);
    insights = readJson(insightsPath);

    if (existsSync(stagingDir)) {
      for (const name of readdirSync(stagingDir)) {
        if (!name.endsWith(".datapack.json")) continue;
        copyFileSync(join(stagingDir, name), join(destDir, name));
        packCount += 1;
      }
    }
  }

  if (!Array.isArray(manifest.streams) || manifest.streams.length === 0) {
    fail(`${id} 的 manifest 没有 streams`);
  }
  if (!insights?.totals) fail(`${id} 的 insights 缺少 totals`);
  if (insights.totals.streamCount !== manifest.streams.length) {
    fail(
      `${id} 的 insights 记录 ${insights.totals.streamCount} 场，与 manifest 的 ${manifest.streams.length} 场不一致；重新运行 publish:data`,
    );
  }

  writeJson(join(destDir, "manifest.json"), manifest);
  writeJson(join(destDir, "insights.json"), insights);

  index.datasets.push({
    id,
    label,
    color: color ?? null,
    channelId: channelId ?? manifest.channelId ?? null,
    count: manifest.streams.length,
    generatedAt: manifest.generatedAt ?? null,
    manifest: `data/${id}/manifest.json`,
    insights: `data/${id}/insights.json`,
  });

  const sourceNote = remoteBase
    ? `manifest/insights 来自 ${remoteBase}`
    : `本地 datapack ${packCount} 份`;
  console.log(`[sync-data] ${label} (${id}) -> ${manifest.streams.length} 场，${sourceNote}`);
}

writeJson(join(outputRoot, "index.json"), index);
console.log(`[sync-data] 完成：${index.datasets.length} 个 dataset -> public/data/index.json`);
