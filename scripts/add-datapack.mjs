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
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const datasourcesPath = join(appRoot, "data-sources.json");

function fail(message) {
  console.error(`[add-datapack] ${message}`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isoJst(date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .replace("Z", "+09:00");
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

const manifest = readJson(manifestPath);
const vstats = pack.vstats;
const chat = pack.chat;
const video = pack.video;

const summary = {
  rank: 0,
  date: (video.startedAt ?? "").slice(0, 10),
  videoId,
  title: video.title ?? "",
  url: video.url ?? `https://www.youtube.com/watch?v=${videoId}`,
  durationHms: video.durationHms,
  durationSec: video.durationSec,
  startedAt: video.startedAt,
  endedAt: video.endedAt,
  availability: video.availability,
  avgConcurrent: vstats?.avgConcurrent ?? null,
  maxConcurrent: vstats?.maxConcurrent ?? null,
  maxConcurrentAt: vstats?.maxConcurrentAt ?? null,
  watchTimeHours: vstats?.watchTimeHours ?? null,
  vstatsViews: vstats?.views ?? null,
  vstatsLikes: vstats?.likes ?? null,
  snapshotViews: video.snapshot?.views ?? null,
  snapshotLikes: video.snapshot?.likes ?? null,
  snapshotComments: video.snapshot?.comments ?? null,
  chatTotal: chat.total,
  chatByKind: chat.byKind,
  pureEmojiOnly: chat.pureEmojiOnly,
  uniqueAuthors: chat.uniqueAuthors,
  superchats: chat.paid.superchats.length,
  scTotalsByCurrency: chat.paid.scTotalsByCurrency,
  stickers: chat.paid.stickers.length,
  memberships: chat.paid.memberships.length,
  commentsCaptured: pack.comments?.total ?? null,
  chatPer1000AvgViewers: pack.derived?.chatPer1000AvgViewers ?? null,
  likesPer1000Views: pack.derived?.likesPer1000Views ?? null,
  scPerHour: pack.derived?.scPerHour ?? null,
  sessionDir: "",
  datapack: relative(appRoot, datapackPath).replaceAll("\\", "/"),
  generatedAt: pack.generatedAt,
};

const streams = Array.isArray(manifest.streams) ? manifest.streams : [];
const nextStreams = streams.filter(item => item.videoId !== videoId);
nextStreams.push(summary);
nextStreams.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
nextStreams.forEach((item, index) => {
  item.rank = index + 1;
});

mkdirSync(datasetDir, { recursive: true });
copyFileSync(packPath, datapackPath);

manifest.streams = nextStreams;
manifest.count = nextStreams.length;
manifest.generatedAt = isoJst(new Date());

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`[add-datapack] ${videoId} -> data/${datasetId}/`);
console.log(`[add-datapack] manifest: ${nextStreams.length} 场`);
console.log("[add-datapack] 下一步：bun run sync:data && bun run validate:data");
