#!/usr/bin/env node
/**
 * 把 manifest / insights 同步到 public/data/，供页面同源加载。
 *
 * 真源在对象存储（R2）：<base>/index.json + <id>/manifest.json + insights.json +
 * <videoId>.datapack.json。页面运行时直接读远端；这里生成的 public/data/ 只是
 * 离线开发和远端不可达时的兜底快照。
 *
 * - 配了 DATAPACK_BASE / VITE_DATAPACK_BASE：拉远端 index / manifest / insights（带本地缓存），
 *   原样写进 public/data/；datapack 不进构建产物。
 * - 没配：回退到本地 data/<id>/（由 publish:data 生成），连同 datapack 一起复制，离线可用。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TRANSCRIPT_INDEX_SCHEMA,
  parseTranscriptFile,
  sortTranscriptEntries,
  toIndexEntry,
} from "../src/lib/transcripts.ts";
import { buildGroupGallery, buildGroupSummary } from "./lib/group-summary.ts";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(appRoot, "data-sources.json");
const outputRoot = join(appRoot, "public", "data");
const transcriptRoot = join(appRoot, "content", "transcripts");
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

/** 组级数据是纯读取的大文件：不缩进，减少传输与解析成本。 */
function writeJsonCompact(path, value) {
  writeFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
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
      console.warn(`[sync-data]   ! ${url} 拉取失败（${describe(error)}），且没有本地缓存`);
      return null;
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
const groupManifests = [];

for (const source of config.datasets) {
  const { id, label, color, avatar, channelId, datapackDir } = source;
  if (!id || !/^[a-z0-9-]+$/.test(id)) fail(`dataset id 非法：${id}`);
  if (!label) fail(`dataset ${id} 缺少 label`);
  if (!datapackDir) fail(`dataset ${id} 缺少 datapackDir`);

  const destDir = join(outputRoot, id);
  const stagingDir = resolve(appRoot, datapackDir);
  const localManifestPath = join(stagingDir, "manifest.json");
  const localInsightsPath = join(stagingDir, "insights.json");

  let manifest;
  let insights;
  let fromRemote = Boolean(remoteBase);

  if (fromRemote) {
    manifest = await fetchJson(
      `${remoteBase}/${id}/manifest.json`,
      join(cacheRoot, id, "manifest.json"),
    );
    insights = manifest
      ? await fetchJson(`${remoteBase}/${id}/insights.json`, join(cacheRoot, id, "insights.json"))
      : null;
    if (manifest && insights) {
      mkdirSync(destDir, { recursive: true });
      // datapack / 作者索引由浏览器直接向远端请求，产物里不留旧副本。
      for (const name of readdirSync(destDir)) {
        if (name.endsWith(".datapack.json")) rmSync(join(destDir, name));
      }
      rmSync(join(destDir, "authors.json"), { force: true });
    } else if (existsSync(localManifestPath) && existsSync(localInsightsPath)) {
      console.warn(`[sync-data]   ! ${id} 远端还没有数据，回退本地暂存区`);
      fromRemote = false;
    } else {
      console.warn(`[sync-data]   ! ${id} 远端和本地都没有数据，跳过`);
      continue;
    }
  }

  if (!fromRemote) {
    if (!existsSync(localManifestPath) || !existsSync(localInsightsPath)) {
      console.warn(`[sync-data]   ! ${id} 还没有本地 ${datapackDir}/manifest.json 或 insights.json，跳过`);
      continue;
    }
    manifest = readJson(localManifestPath);
    insights = readJson(localInsightsPath);
  }

  mkdirSync(destDir, { recursive: true });
  let packCount = 0;
  if (!fromRemote) {
    for (const name of readdirSync(stagingDir)) {
      if (!name.endsWith(".datapack.json")) continue;
      copyFileSync(join(stagingDir, name), join(destDir, name));
      packCount += 1;
    }
    const localAuthorsPath = join(stagingDir, "authors.json");
    if (existsSync(localAuthorsPath)) {
      copyFileSync(localAuthorsPath, join(destDir, "authors.json"));
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
  groupManifests.push({ id, streams: manifest.streams });

  index.datasets.push({
    id,
    label,
    color: color ?? null,
    avatar: avatar ?? null,
    channelId: channelId ?? manifest.channelId ?? null,
    count: manifest.streams.length,
    generatedAt: manifest.generatedAt ?? null,
    manifest: `data/${id}/manifest.json`,
    insights: `data/${id}/insights.json`,
  });

  const sourceNote = fromRemote
    ? `manifest/insights 来自 ${remoteBase}`
    : `本地 datapack ${packCount} 份`;
  console.log(`[sync-data] ${label} (${id}) -> ${manifest.streams.length} 场，${sourceNote}`);
}

// 组级数据：首页只读 summary（聚合 + 最近若干行），相册才读完整精简行。
if (groupManifests.length > 0) {
  const groupSummary = buildGroupSummary(groupManifests, index.generatedAt);
  const groupGallery = buildGroupGallery(groupManifests, index.generatedAt);
  writeJsonCompact(join(outputRoot, "group-summary.json"), groupSummary);
  writeJsonCompact(join(outputRoot, "group-gallery.json"), groupGallery);
  const groupStreams = groupSummary.members.reduce((sum, member) => sum + member.streamCount, 0);
  console.log(`[sync-data] 组级数据：${groupStreams} 场 / ${groupSummary.days.length} 个日期桶 -> public/data/group-summary.json + group-gallery.json`);
} else {
  rmSync(join(outputRoot, "group-summary.json"), { force: true });
  rmSync(join(outputRoot, "group-gallery.json"), { force: true });
}

// 逐字稿索引：列表页只需要 frontmatter（标题 / 日期 / 标签），正文仍由页面按需加载。
function buildTranscriptIndex() {
  if (!existsSync(transcriptRoot)) return null;
  const entries = [];
  for (const dirent of readdirSync(transcriptRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory() || dirent.name.startsWith("_") || dirent.name.startsWith(".")) continue;
    const datasetId = dirent.name;
    for (const name of readdirSync(join(transcriptRoot, datasetId)).sort()) {
      // 以 `_` / `.` 开头的文件是草稿或模板，不参与索引（与 publish:transcripts 一致）。
      if (!name.endsWith(".md") || name.startsWith("_") || name.startsWith(".")) continue;
      const path = join(transcriptRoot, datasetId, name);
      try {
        const file = parseTranscriptFile(readFileSync(path, "utf8"), path);
        entries.push(toIndexEntry({ ...file, datasetId }, statSync(path).mtime.toISOString()));
      } catch (error) {
        console.warn(`[sync-data]   ! ${relative(appRoot, path)} 解析失败，已跳过：${describe(error)}`);
      }
    }
  }
  return {
    schema: TRANSCRIPT_INDEX_SCHEMA,
    generatedAt: new Date().toISOString(),
    entries: sortTranscriptEntries(entries),
  };
}

const transcriptIndex = buildTranscriptIndex();
if (transcriptIndex) {
  const transcriptDir = join(outputRoot, "transcripts");
  mkdirSync(transcriptDir, { recursive: true });
  writeJsonCompact(join(transcriptDir, "index.json"), transcriptIndex);
  console.log(`[sync-data] 逐字稿索引：${transcriptIndex.entries.length} 篇 -> public/data/transcripts/index.json`);
} else {
  rmSync(join(outputRoot, "transcripts"), { recursive: true, force: true });
}

// 远端 index 由 publish:data 生成，是页面实际会读的那份；能用就用它，避免构建快照漂移。
let publishedIndex = null;
if (remoteBase) {
  publishedIndex = await fetchJson(`${remoteBase}/index.json`, join(cacheRoot, "index.json"));
}
const publishedIds = new Set(
  Array.isArray(publishedIndex?.datasets) ? publishedIndex.datasets.map(dataset => dataset.id) : [],
);
const covered =
  index.datasets.length > 0 && index.datasets.every(dataset => publishedIds.has(dataset.id));
if (publishedIndex && !covered) {
  console.warn("[sync-data]   ! 远端 index 与本仓库 data-sources.json 不一致，先用本地构造的索引");
}
const outputIndex = covered ? publishedIndex : index;

writeJson(join(outputRoot, "index.json"), outputIndex);
console.log(
  `[sync-data] 完成：${outputIndex.datasets.length} 个 dataset -> public/data/index.json${
    covered ? "（来自对象存储）" : ""
  }`,
);
