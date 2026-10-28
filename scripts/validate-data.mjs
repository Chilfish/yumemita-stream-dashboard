#!/usr/bin/env node
/**
 * 校验 public/data 下的生成物：index -> manifest -> datapack。
 * 适合在 CI 或改动数据源后跑一遍。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = join(appRoot, "public", "data");
const errors = [];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

const indexPath = join(dataRoot, "index.json");
if (!existsSync(indexPath)) {
  console.error("[validate-data] 缺少 public/data/index.json，请先运行 sync:data");
  process.exit(1);
}

const index = readJson(indexPath);
if (!index || !Array.isArray(index.datasets) || index.datasets.length === 0) {
  console.error("[validate-data] index.json 没有 datasets");
  process.exit(1);
}

let checked = 0;
for (const dataset of index.datasets) {
  const manifestPath = join(appRoot, "public", dataset.manifest);
  const manifest = readJson(manifestPath);
  if (!manifest) continue;
  if (!Array.isArray(manifest.streams)) {
    errors.push(`${dataset.id}: manifest.streams 不是数组`);
    continue;
  }
  for (const stream of manifest.streams) {
    const packPath = join(dataRoot, dataset.id, `${stream.videoId}.datapack.json`);
    const pack = readJson(packPath);
    if (!pack) continue;
    checked += 1;
    if (pack.schema !== "yumemita.stream-datapack/v1") errors.push(`${stream.videoId}: schema 不匹配`);
    if (pack.video?.id !== stream.videoId) errors.push(`${stream.videoId}: video.id 不匹配`);
    if (!Number.isFinite(pack.chat?.total)) errors.push(`${stream.videoId}: chat.total 缺失`);
    if (!Array.isArray(pack.chat?.density?.perMinute)) errors.push(`${stream.videoId}: density.perMinute 缺失`);
  }
}

if (errors.length > 0) {
  console.error(`[validate-data] ${errors.length} 个问题`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`[validate-data] OK：${checked} 份 datapack 通过校验`);
