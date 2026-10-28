#!/usr/bin/env bun
/**
 * 校验 public/data 下的生成物：index -> manifest -> datapack。
 * schema 定义见 scripts/validate-schema.ts（valibot）；这里只做跨文件检查。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { safeParse } from "valibot";
import {
  DatapackSchema,
  DatasetIndexSchema,
  InsightsSchema,
  ManifestSchema,
  formatIssues,
} from "./validate-schema.ts";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = join(appRoot, "public", "data");
const errors = [];

function rel(path) {
  return relative(appRoot, path).split(sep).join("/");
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${rel(path)}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function pushIssues(label, issues) {
  errors.push(...formatIssues(issues).map((issue) => `${label}: ${issue}`));
}

const indexPath = join(dataRoot, "index.json");
if (!existsSync(indexPath)) {
  console.error("[validate-data] 缺少 public/data/index.json，请先运行 sync:data");
  process.exit(1);
}

const index = readJson(indexPath);
if (index === null) {
  console.error("[validate-data] index.json 无法读取");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const indexResult = safeParse(DatasetIndexSchema, index);
if (!indexResult.success) {
  console.error("[validate-data] index.json 校验失败");
  for (const issue of formatIssues(indexResult)) console.error(`  - ${issue}`);
  process.exit(1);
}

let checked = 0;
for (const dataset of indexResult.output.datasets) {
  const manifestPath = join(appRoot, "public", dataset.manifest);
  const manifest = readJson(manifestPath);
  if (manifest === null) continue;

  const manifestResult = safeParse(ManifestSchema, manifest);
  if (!manifestResult.success) {
    pushIssues(`${dataset.id}: manifest`, manifestResult);
    continue;
  }
  if (manifestResult.output.streams.length === 0) {
    errors.push(`${dataset.id}: manifest.streams 为空`);
    continue;
  }

  const insightsResult = safeParse(
    InsightsSchema,
    readJson(join(appRoot, "public", dataset.insights ?? `data/${dataset.id}/insights.json`)),
  );
  if (!insightsResult.success) pushIssues(`${dataset.id}: insights.json`, insightsResult);

  for (const stream of manifestResult.output.streams) {
    const packPath = join(dataRoot, dataset.id, `${stream.videoId}.datapack.json`);
    if (!existsSync(packPath)) {
      errors.push(`${stream.videoId}: 缺少 datapack 文件 ${rel(packPath)}`);
      continue;
    }

    const rawPack = readJson(packPath);
    if (rawPack === null) continue;
    if (rawPack?.video?.id !== stream.videoId) errors.push(`${stream.videoId}: video.id 不匹配`);

    const packResult = safeParse(DatapackSchema, rawPack);
    if (!packResult.success) {
      pushIssues(stream.videoId, packResult);
      continue;
    }
    checked += 1;
  }
}

if (errors.length > 0) {
  console.error(`[validate-data] ${errors.length} 个问题`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`[validate-data] OK：${checked} 份 datapack 通过校验`);
