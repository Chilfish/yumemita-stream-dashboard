import type { DatasetTotals } from "@/lib/aggregate";
import type { StreamDatapack } from "@/types/datapack";
import type { BatchManifest, DatasetIndex } from "@/types/dataset";

const LOCAL_DATA_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/data`;

/**
 * 对象存储根地址（R2 等）。配置后索引、manifest、insights、datapack 全部走远端，
 * 发布后刷新即可；留空时回退到构建产物里的 `public/data`（离线开发）。
 */
const REMOTE_BASE = (import.meta.env.VITE_DATAPACK_BASE ?? "").replace(/\/+$/, "");

/**
 * 索引的 `generatedAt`。manifest / insights 每次发布都会变，带版本参数可以绕开
 * CDN 上的旧缓存；索引本身每次启动都重新取一次。
 */
let dataVersion = "";

function versioned(path: string): string {
  const url = `${REMOTE_BASE}/${path}`;
  return dataVersion ? `${url}?v=${encodeURIComponent(dataVersion)}` : url;
}

async function fetchJson<T>(url: string, signal?: AbortSignal, cache?: RequestCache): Promise<T> {
  const response = await fetch(url, { signal, cache, headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`加载 ${url} 失败（HTTP ${response.status}）`);
  }
  return (await response.json()) as T;
}

/** 远端优先；索引还没发布或临时不可达时，回退到构建时的同源快照。 */
async function fetchRemoteFirst<T>(path: string, signal?: AbortSignal, fresh = false): Promise<T> {
  if (!REMOTE_BASE) {
    return fetchJson<T>(`${LOCAL_DATA_BASE}/${path}`, signal);
  }

  const url = fresh ? `${REMOTE_BASE}/${path}?t=${Date.now()}` : versioned(path);
  try {
    return await fetchJson<T>(url, signal, fresh ? "no-store" : undefined);
  } catch {
    return fetchJson<T>(`${LOCAL_DATA_BASE}/${path}`, signal);
  }
}

export async function fetchDatasetIndex(signal?: AbortSignal): Promise<DatasetIndex> {
  const index = await fetchRemoteFirst<DatasetIndex>("index.json", signal, true);
  if (!Array.isArray(index.datasets) || index.datasets.length === 0) {
    throw new Error("index.json 里没有可用的 dataset，请先运行 bun run publish:data");
  }
  dataVersion = index.generatedAt ?? "";
  return index;
}

export async function fetchManifest(datasetId: string, signal?: AbortSignal): Promise<BatchManifest> {
  const manifest = await fetchRemoteFirst<BatchManifest>(`${datasetId}/manifest.json`, signal);
  if (!Array.isArray(manifest.streams) || manifest.streams.length === 0) {
    throw new Error(`${datasetId} 的 manifest 没有 streams`);
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
    throw new Error(`${datasetId} 的 insights.json 缺少 totals，请重新运行 bun run publish:data`);
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
  const request = (REMOTE_BASE
    ? fetchJson<StreamDatapack>(`${REMOTE_BASE}/${datasetId}/${videoId}.datapack.json`)
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
