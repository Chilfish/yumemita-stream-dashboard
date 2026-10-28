#!/usr/bin/env node
/**
 * 把 data-sources.json 里登记的归档数据同步到 public/data/。
 *
 * 设计要点：
 * - public/data/ 是生成物，不进 git；每次 dev/build 前自动同步。
 * - 每个 dataset 一个子目录，文件名沿用 videoId，方便直接对照归档。
 * - 只复制 manifest 里登记过的 datapack，避免把无关 JSON 带进前端。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateDataset, buildStreamRows } from "../src/lib/aggregate.ts";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(appRoot, "data-sources.json");
const outputRoot = join(appRoot, "public", "data");

function fail(message) {
  console.error(`[sync-data] ${message}`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assert(condition, message) {
  if (!condition) fail(message);
}

const config = readJson(configPath);
assert(Array.isArray(config.datasets) && config.datasets.length > 0, "data-sources.json 里没有 datasets");

mkdirSync(outputRoot, { recursive: true });

const index = {
  schema: "yumemita.dashboard.datasets/v1",
  generatedAt: new Date().toISOString(),
  datasets: [],
};

for (const source of config.datasets) {
  const { id, label, channelId, manifest: manifestRel, datapackDir } = source;
  assert(id && /^[a-z0-9-]+$/.test(id), `dataset id 非法：${id}`);
  assert(label, `dataset ${id} 缺少 label`);
  assert(manifestRel && datapackDir, `dataset ${id} 缺少 manifest 或 datapackDir`);

  const manifestPath = resolve(appRoot, manifestRel);
  const datapackRoot = resolve(appRoot, datapackDir);
  assert(existsSync(manifestPath), `找不到 manifest：${manifestPath}`);
  assert(existsSync(datapackRoot), `找不到 datapackDir：${datapackRoot}`);

  const manifest = readJson(manifestPath);
  assert(Array.isArray(manifest.streams) && manifest.streams.length > 0, `${id} 的 manifest 没有 streams`);

  const destDir = join(outputRoot, id);
  mkdirSync(destDir, { recursive: true });

  const copied = [];
  const warnings = [];
  const packs = new Map();
  for (const stream of manifest.streams) {
    const videoId = stream.videoId;
    if (!videoId) {
      warnings.push("manifest 中有缺少 videoId 的条目，已跳过");
      continue;
    }
    const sourcePath = join(datapackRoot, `${videoId}.datapack.json`);
    if (!existsSync(sourcePath)) {
      warnings.push(`${videoId} 缺少 datapack，已跳过`);
      continue;
    }
    const pack = readJson(sourcePath);
    if (pack?.video?.id !== videoId) {
      warnings.push(`${videoId} 的 datapack id 不匹配，已跳过`);
      continue;
    }
    copyFileSync(sourcePath, join(destDir, `${videoId}.datapack.json`));
    packs.set(videoId, pack);
    copied.push(videoId);
  }

  assert(copied.length > 0, `${id} 没有可复制的 datapack`);
  writeFileSync(
    join(destDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  const totals = aggregateDataset(buildStreamRows(manifest, packs));
  writeFileSync(
    join(destDir, "insights.json"),
    `${JSON.stringify(
      {
        schema: "yumemita.dashboard.insights/v1",
        generatedAt: new Date().toISOString(),
        totals,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  index.datasets.push({
    id,
    label,
    channelId: channelId ?? manifest.channelId ?? null,
    count: copied.length,
    generatedAt: manifest.generatedAt ?? null,
    manifest: `data/${id}/manifest.json`,
    insights: `data/${id}/insights.json`,
  });

  console.log(`[sync-data] ${label} (${id}) -> ${copied.length}/${manifest.streams.length} 场`);
  for (const warning of warnings) console.warn(`[sync-data]   ! ${warning}`);
}

writeFileSync(
  join(outputRoot, "index.json"),
  `${JSON.stringify(index, null, 2)}\n`,
  "utf8",
);
console.log(`[sync-data] 完成：${index.datasets.length} 个 dataset -> public/data/index.json`);
