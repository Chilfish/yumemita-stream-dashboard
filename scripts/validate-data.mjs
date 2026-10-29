#!/usr/bin/env bun
/**
 * 校验生成物：index -> manifest -> insights。
 *
 * datapack 不在仓库里，默认只做本地校验；加 `--remote` 时会按
 * `DATAPACK_BASE` / `VITE_DATAPACK_BASE` 逐条 HEAD，确认对象存储可达。
 *
 *   bun run validate:data
 *   bun run validate:data -- --remote
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { safeParse } from "valibot";
import {
  DatasetIndexSchema,
  InsightsSchema,
  ManifestSchema,
  formatIssues,
} from "./validate-schema.ts";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = join(appRoot, "public", "data");
const remoteBase = (process.env.DATAPACK_BASE ?? process.env.VITE_DATAPACK_BASE ?? "").replace(/\/+$/, "");
const checkRemote = process.argv.includes("--remote");
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

function pushIssues(label, result) {
  errors.push(...formatIssues(result).map((issue) => `${label}: ${issue}`));
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

const targets = [];
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

  const streams = manifestResult.output.streams;
  if (streams.length === 0) {
    errors.push(`${dataset.id}: manifest.streams 为空`);
    continue;
  }

  const insightsResult = safeParse(
    InsightsSchema,
    readJson(join(appRoot, "public", dataset.insights ?? `data/${dataset.id}/insights.json`)),
  );
  if (!insightsResult.success) {
    pushIssues(`${dataset.id}: insights.json`, insightsResult);
  } else if (insightsResult.output.totals.streamCount !== streams.length) {
    errors.push(
      `${dataset.id}: insights.json 记录 ${insightsResult.output.totals.streamCount} 场，与 manifest 的 ${streams.length} 场不一致`,
    );
  }

  for (const stream of streams) {
    if (!stream.videoId) {
      errors.push(`${dataset.id}: 存在缺少 videoId 的场次`);
      continue;
    }
    targets.push({ datasetId: dataset.id, videoId: stream.videoId });
    checked += 1;
  }
}

async function verifyRemote() {
  if (!remoteBase) {
    console.error(
      "[validate-data] --remote 需要设置 DATAPACK_BASE 或 VITE_DATAPACK_BASE（datapack 的对象存储根地址）",
    );
    process.exit(1);
  }

  const urls = [
    `${remoteBase}/index.json`,
    ...indexResult.output.datasets.flatMap((dataset) => [
      `${remoteBase}/${dataset.id}/manifest.json`,
      `${remoteBase}/${dataset.id}/insights.json`,
    ]),
    ...targets.map((target) => `${remoteBase}/${target.datasetId}/${target.videoId}.datapack.json`),
  ];

  const failures = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(8, urls.length) }, async () => {
    for (;;) {
      const url = urls[cursor];
      cursor += 1;
      if (!url) return;
      try {
        const response = await fetch(url, {
          method: "HEAD",
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) failures.push(`${url} -> HTTP ${response.status}`);
      } catch (error) {
        failures.push(`${url} -> ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
  await Promise.all(workers);

  if (failures.length > 0) {
    errors.push(`${failures.length}/${urls.length} 个对象在对象存储上不可达`);
    errors.push(...failures.slice(0, 20));
  }
  return urls.length;
}

const remoteCount = checkRemote ? await verifyRemote() : 0;

if (errors.length > 0) {
  console.error(`[validate-data] ${errors.length} 个问题`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const remoteNote = checkRemote ? `，对象存储 ${remoteCount} 个对象全部可达` : "";
console.log(`[validate-data] OK：${checked} 场${remoteNote}`);
