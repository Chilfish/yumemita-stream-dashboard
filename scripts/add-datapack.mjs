#!/usr/bin/env node
/**
 * 把一份 datapack 加入某个 dataset：
 *   bun scripts/add-datapack.mjs <datasetId> <path/to/datapack.json>
 *
 * - 校验 schema 与 video.id
 * - 复制到 data/<datasetId>/<videoId>.datapack.json
 * - 从 datapack 抽出 manifest 摘要，按 videoId upsert，按开播时间重排 rank
 * - 更新 count / generatedAt
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { upsertManifestStream } from "./lib/dataset-manifest.ts";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const datasourcesPath = join(appRoot, "data-sources.json");

function fail(message) {
  console.error(`[add-datapack] ${message}`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const [datasetId, inputPath] = process.argv.slice(2);
if (!datasetId || !inputPath) {
  fail("用法：bun scripts/add-datapack.mjs <datasetId> <path/to/datapack.json>");
}

const sources = readJson(datasourcesPath);
const source = sources.datasets?.find(item => item.id === datasetId);
if (!source) fail(`data-sources.json 里没有 dataset：${datasetId}`);

const packPath = resolve(process.cwd(), inputPath);
if (!existsSync(packPath)) fail(`找不到文件：${packPath}`);

const pack = readJson(packPath);
if (pack.schema !== "yumemita.stream-datapack/v1") {
  fail(`不支持的 schema：${pack.schema}`);
}
const videoId = pack.video?.id;
if (!videoId) fail("datapack 缺少 video.id");

const manifestPath = resolve(appRoot, source.manifest ?? join("data", datasetId, "manifest.json"));
if (!existsSync(manifestPath)) fail(`找不到 manifest：${manifestPath}`);
const datasetDir = dirname(manifestPath);
const datapackPath = join(datasetDir, `${videoId}.datapack.json`);

mkdirSync(datasetDir, { recursive: true });
copyFileSync(packPath, datapackPath);

const datapackRel = relative(appRoot, datapackPath).replaceAll("\\", "/");
const { count } = upsertManifestStream(manifestPath, pack, datapackRel);

console.log(`[add-datapack] ${videoId} -> data/${datasetId}/`);
console.log(`[add-datapack] manifest: ${count} 场`);
console.log("[add-datapack] 下一步：bun run sync:data && bun run validate:data");
