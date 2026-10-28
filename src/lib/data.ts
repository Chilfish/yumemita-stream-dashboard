import type { DatasetTotals } from "@/lib/aggregate";
import type { StreamDatapack } from "@/types/datapack";
import type { BatchManifest, DatasetIndex } from "@/types/dataset";

const DATA_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/data`;

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${DATA_BASE}/${path}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`加载 ${path} 失败（HTTP ${response.status}）`);
  }
  return (await response.json()) as T;
}

export async function fetchDatasetIndex(signal?: AbortSignal): Promise<DatasetIndex> {
  const index = await fetchJson<DatasetIndex>("index.json", signal);
  if (!Array.isArray(index.datasets) || index.datasets.length === 0) {
    throw new Error("index.json 里没有可用的 dataset，请先运行 bun run sync:data");
  }
  return index;
}

export async function fetchManifest(datasetId: string, signal?: AbortSignal): Promise<BatchManifest> {
  const manifest = await fetchJson<BatchManifest>(`${datasetId}/manifest.json`, signal);
  if (!Array.isArray(manifest.streams) || manifest.streams.length === 0) {
    throw new Error(`${datasetId} 的 manifest 没有 streams`);
  }
  return manifest;
}

export async function fetchInsights(
  datasetId: string,
  signal?: AbortSignal,
): Promise<DatasetTotals> {
  const file = await fetchJson<{ totals?: DatasetTotals }>(`${datasetId}/insights.json`, signal);
  if (!file.totals) {
    throw new Error(`${datasetId} 的 insights.json 缺少 totals，请重新运行 bun run sync:data`);
  }
  return file.totals;
}

const packCache = new Map<string, StreamDatapack>();
const inflightPacks = new Map<string, Promise<StreamDatapack>>();

export function fetchDatapack(
  datasetId: string,
  videoId: string,
  signal?: AbortSignal,
): Promise<StreamDatapack> {
  const key = `${datasetId}/${videoId}`;
  const cached = packCache.get(key);
  if (cached) return Promise.resolve(cached);

  const inflight = inflightPacks.get(key);
  if (inflight) return inflight;

  const request = fetchJson<StreamDatapack>(`${datasetId}/${videoId}.datapack.json`, signal)
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
