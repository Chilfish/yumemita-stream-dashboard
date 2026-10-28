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

export async function fetchDatapack(
  datasetId: string,
  videoId: string,
  signal?: AbortSignal,
): Promise<StreamDatapack> {
  return fetchJson<StreamDatapack>(`${datasetId}/${videoId}.datapack.json`, signal);
}

const LOAD_CONCURRENCY = 6;

export async function loadDatapacks(
  datasetId: string,
  manifest: BatchManifest,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Map<string, StreamDatapack>> {
  const total = manifest.streams.length;
  const queue = [...manifest.streams];
  const result = new Map<string, StreamDatapack>();
  let loaded = 0;

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      if (signal?.aborted) return;
      const stream = queue.shift();
      if (!stream) return;
      const pack = await fetchDatapack(datasetId, stream.videoId, signal);
      result.set(stream.videoId, pack);
      loaded += 1;
      onProgress?.(loaded, total);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(LOAD_CONCURRENCY, total) }, () => worker()),
  );
  return result;
}
