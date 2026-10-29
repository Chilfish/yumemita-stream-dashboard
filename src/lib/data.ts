import type { DatasetTotals } from "@/lib/aggregate";
import { THUMB_VARIANTS, thumbVariantName } from "@/lib/thumb-variants";
import type { StreamDatapack } from "@/types/datapack";
import type { BatchManifest, DatasetIndex } from "@/types/dataset";

export const LOCAL_DATA_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/data`;

/**
 * 对象存储根地址（R2 等）。配置后索引、manifest、insights、datapack 全部走远端，
 * 发布后刷新即可；留空时回退到构建产物里的 `public/data`（离线开发）。
 */
export const REMOTE_DATA_BASE = (import.meta.env.VITE_DATAPACK_BASE ?? "").replace(/\/+$/, "");

function thumbAsset(datasetId: string, name: string): string {
  const path = `${datasetId}/thumbs/${name}`;
  return REMOTE_DATA_BASE ? `${REMOTE_DATA_BASE}/${path}` : `${LOCAL_DATA_BASE}/${path}`;
}

/** 单场封面原图：对象存储的 `<dataset>/thumbs/<videoId>.jpg`，未配置远端时读同源快照。 */
export function thumbnailUrl(datasetId: string, videoId: string): string {
  return thumbAsset(datasetId, `${encodeURIComponent(videoId)}.jpg`);
}

/**
 * 同一张封面的三档 WebP 变体（480 / 960 / 1280w），交给浏览器按 `sizes` 挑选：
 * 列表里的 64px 缩略图只下 480w（约 18 KB），不再为人人都拉 1280w 原图。
 */
export function thumbnailSrcSet(datasetId: string, videoId: string): string {
  const id = encodeURIComponent(videoId);
  return THUMB_VARIANTS.map(
    width => `${thumbAsset(datasetId, thumbVariantName(id, width))} ${width}w`,
  ).join(", ");
}

/**
 * 索引的 `generatedAt`。manifest / insights 每次发布都会变，带版本参数可以绕开
 * CDN 上的旧缓存；索引本身每次启动都重新取一次。
 */
let dataVersion = "";

function versioned(path: string): string {
  const url = `${REMOTE_DATA_BASE}/${path}`;
  return dataVersion ? `${url}?v=${encodeURIComponent(dataVersion)}` : url;
}

async function fetchJson<T>(url: string, signal?: AbortSignal, cache?: RequestCache): Promise<T> {
  const response = await fetch(url, { signal, cache, headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error("数据加载失败。");
  }
  return (await response.json()) as T;
}

/** 远端优先；索引还没发布或临时不可达时，回退到构建时的同源快照。 */
async function fetchRemoteFirst<T>(path: string, signal?: AbortSignal, fresh = false): Promise<T> {
  if (!REMOTE_DATA_BASE) {
    return fetchJson<T>(`${LOCAL_DATA_BASE}/${path}`, signal);
  }

  const url = fresh ? `${REMOTE_DATA_BASE}/${path}?t=${Date.now()}` : versioned(path);
  try {
    return await fetchJson<T>(url, signal, fresh ? "no-store" : undefined);
  } catch {
    return fetchJson<T>(`${LOCAL_DATA_BASE}/${path}`, signal);
  }
}

export async function fetchDatasetIndex(signal?: AbortSignal): Promise<DatasetIndex> {
  const index = await fetchRemoteFirst<DatasetIndex>("index.json", signal, true);
  if (!Array.isArray(index.datasets) || index.datasets.length === 0) {
    throw new Error("没有可用的成员数据。");
  }
  dataVersion = index.generatedAt ?? "";
  return index;
}

export async function fetchManifest(datasetId: string, signal?: AbortSignal): Promise<BatchManifest> {
  const manifest = await fetchRemoteFirst<BatchManifest>(`${datasetId}/manifest.json`, signal);
  if (!Array.isArray(manifest.streams) || manifest.streams.length === 0) {
    throw new Error("成员数据为空。");
  }
  return manifest;
}

export async function fetchInsights(
  datasetId: string,
  signal?: AbortSignal,
): Promise<DatasetTotals> {
  const file = await fetchRemoteFirst<{ totals?: DatasetTotals }>(
    `${datasetId}/insights.json`,
    signal,
  );
  if (!file.totals) {
    throw new Error("汇总数据不完整。");
  }
  return file.totals;
}

const packCache = new Map<string, StreamDatapack>();
const inflightPacks = new Map<string, Promise<StreamDatapack>>();

export function fetchDatapack(datasetId: string, videoId: string): Promise<StreamDatapack> {
  const key = `${datasetId}/${videoId}`;
  const cached = packCache.get(key);
  if (cached) return Promise.resolve(cached);

  const inflight = inflightPacks.get(key);
  if (inflight) return inflight;

  // Shared requests are not tied to one component's AbortSignal: aborting a
  // consumer must not reject the promise a later mount reuses.
  const localUrl = `${LOCAL_DATA_BASE}/${datasetId}/${videoId}.datapack.json`;
  const request = (REMOTE_DATA_BASE
    ? fetchJson<StreamDatapack>(`${REMOTE_DATA_BASE}/${datasetId}/${videoId}.datapack.json`)
        .catch(() => fetchJson<StreamDatapack>(localUrl))
    : fetchJson<StreamDatapack>(localUrl))
    .then(pack => {
      packCache.set(key, pack);
      return pack;
    })
    .finally(() => {
      inflightPacks.delete(key);
    });

  inflightPacks.set(key, request);
  return request;
}
