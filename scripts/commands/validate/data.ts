#!/usr/bin/env bun
/**
 * 校验本地 datapack（唯一真源）。
 *
 *   bun run validate:data
 *   bun run validate:data -- --remote   # 额外 HEAD R2 archive 对象
 *
 * 整站对账以 `db:verify` 为准；这里只保证 pack 能被 ingest 正常消费。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { safeParse } from "valibot";
import { DatapackSchema, formatIssues } from "./validate-schema.ts";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const remoteBase = (process.env.DATAPACK_BASE ?? "").replace(/\/+$/, "");
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

const config = readJson(join(appRoot, "data-sources.json"));
if (!config || !Array.isArray(config.datasets) || config.datasets.length === 0) {
  console.error("[validate-data] data-sources.json 里没有 datasets");
  process.exit(1);
}

const targets = [];

for (const dataset of config.datasets) {
  const dir = join(appRoot, "data", dataset.id);
  if (!existsSync(dir)) {
    errors.push(`缺少 ${rel(dir)}`);
    continue;
  }

  const files = readdirSync(dir).filter((name) => name.endsWith(".datapack.json"));
  if (files.length === 0) {
    errors.push(`${dataset.id}: 目录里没有 datapack`);
    continue;
  }

  for (const name of files) {
    const path = join(dir, name);
    const videoId = basename(name, ".datapack.json");
    const pack = readJson(path);
    if (pack === null) continue;

    const result = safeParse(DatapackSchema, pack);
    if (!result.success) {
      errors.push(...formatIssues(result).map((issue) => `${rel(path)}: ${issue}`));
      continue;
    }
    if (result.output.video?.id !== videoId) {
      errors.push(
        `${rel(path)}: video.id (${result.output.video?.id ?? "缺失"}) 与文件名 ${videoId} 不一致`,
      );
      continue;
    }
    targets.push({ datasetId: dataset.id, videoId });
  }
}

async function verifyRemote() {
  if (!remoteBase) {
    console.error("[validate-data] --remote 需要设置 DATAPACK_BASE（对象存储公开根地址）");
    process.exit(1);
  }

  const urls = targets.map(
    ({ datasetId, videoId }) => `${remoteBase}/archive/${datasetId}/${videoId}.datapack.json`,
  );
  const failures = [];
  let cursor = 0;

  const workers = Array.from({ length: Math.min(8, urls.length) }, async () => {
    for (;;) {
      const url = urls[cursor];
      cursor += 1;
      if (!url) return;
      try {
        const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
        if (!response.ok) failures.push(`${url} -> HTTP ${response.status}`);
      } catch (error) {
        failures.push(`${url} -> ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
  await Promise.all(workers);

  if (failures.length > 0) {
    errors.push(`${failures.length}/${urls.length} 个 archive 对象不可达`);
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

const remoteNote = checkRemote ? `，archive ${remoteCount} 个对象可达` : "";
console.log(`[validate-data] OK：${targets.length} 场${remoteNote}`);
