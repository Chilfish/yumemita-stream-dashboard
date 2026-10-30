import type { DatasetTotals } from "@/lib/aggregate";
import type { AuthorIndexFile } from "@/lib/author-index";
import { THUMB_VARIANTS, thumbVariantName } from "@/lib/thumb-variants";
import type { StreamDatapack } from "@/types/datapack";
import type { BatchManifest, DatasetIndex } from "@/types/dataset";
import {
  GROUP_GALLERY_SCHEMA,
  GROUP_SUMMARY_SCHEMA,
  type GroupGalleryFile,
  type GroupSummaryFile,
} from "@/types/group";

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
 * CDN 上的旧缓存。
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

interface CacheEntry<T> {
  value: T;
  at: number;
}

interface CachedDatasetIndex {
  savedAt: number;
  index: DatasetIndex;
}

/** 缓存只用于首帧：超过 TTL 就不再展示，但仍然会后台重新校验。 */
const INDEX_CACHE_TTL_MS = 10 * 60 * 1000;
const DATASET_RESOURCE_TTL_MS = 5 * 60 * 1000;
const INDEX_CACHE_KEY = `yumemita:dataset-index:${REMOTE_DATA_BASE || "local"}`;

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** 共享请求不绑定某个组件的 signal：一个消费者取消，不应影响另一个消费者复用的请求。 */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * manifest / insights 在一次页面会话里不会变：缓存 + in-flight 去重。
 * 先渲染、再后台校验索引时，同一份请求会被页面直接复用。
 */
function datasetResource<T>(load: (datasetId: string) => Promise<T>) {
  const cache = new Map<string, CacheEntry<T>>();
  const inflight = new Map<string, Promise<T>>();

  return {
    clear(): void {
      cache.clear();
    },
    fetch(datasetId: string, signal?: AbortSignal): Promise<T> {
      const cached = cache.get(datasetId);
      if (cached && Date.now() - cached.at < DATASET_RESOURCE_TTL_MS) {
        return abortable(Promise.resolve(cached.value), signal);
      }

      let request = inflight.get(datasetId);
      if (!request) {
        request = load(datasetId)
          .then(value => {
            cache.set(datasetId, { value, at: Date.now() });
            return value;
          })
          .finally(() => {
            inflight.delete(datasetId);
          });
        inflight.set(datasetId, request);
      }
      return abortable(request, signal);
    },
  };
}

const manifestResource = datasetResource<BatchManifest>(async datasetId => {
  const manifest = await fetchRemoteFirst<BatchManifest>(`${datasetId}/manifest.json`);
  if (!Array.isArray(manifest.streams) || manifest.streams.length === 0) {
    throw new Error("成员数据为空。");
  }
  return manifest;
});

const insightsResource = datasetResource<DatasetTotals>(async datasetId => {
  const file = await fetchRemoteFirst<{ totals?: DatasetTotals }>(`${datasetId}/insights.json`);
  if (!file.totals) {
    throw new Error("汇总数据不完整。");
  }
  return file.totals;
});

const groupSummaryResource = datasetResource<GroupSummaryFile>(async () => {
  const file = await fetchRemoteFirst<GroupSummaryFile>("group-summary.json");
  if (
    file?.schema !== GROUP_SUMMARY_SCHEMA ||
    !Array.isArray(file.members) ||
    !Array.isArray(file.days) ||
    !Array.isArray(file.latest) ||
    !Array.isArray(file.recent)
  ) {
    throw new Error("组数据不完整。");
  }
  return file;
});

const groupGalleryResource = datasetResource<GroupGalleryFile>(async () => {
  const file = await fetchRemoteFirst<GroupGalleryFile>("group-gallery.json");
  if (file?.schema !== GROUP_GALLERY_SCHEMA || !Array.isArray(file.streams)) {
    throw new Error("组相册数据不完整。");
  }
  return file;
});

interface CachedGroupSummary {
  savedAt: number;
  version: string;
  data: GroupSummaryFile;
}

const GROUP_SUMMARY_CACHE_KEY = `yumemita:group-summary:${REMOTE_DATA_BASE || "local"}`;
const GROUP_SUMMARY_CACHE_TTL_MS = 10 * 60 * 1000;

/** 组首页的小文件（约 24 KB gzip）值得放进 sessionStorage：刷新时直接出内容。 */
export function readCachedGroupSummary(): GroupSummaryFile | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(GROUP_SUMMARY_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedGroupSummary;
    if (!cached?.data || cached.version !== dataVersion) return null;
    if (Date.now() - cached.savedAt > GROUP_SUMMARY_CACHE_TTL_MS) return null;
    return cached.data;
  } catch {
    return null;
  }
}

function writeCachedGroupSummary(data: GroupSummaryFile): void {
  const store = storage();
  if (!store) return;
  try {
    const cached: CachedGroupSummary = { savedAt: Date.now(), version: dataVersion, data };
    store.setItem(GROUP_SUMMARY_CACHE_KEY, JSON.stringify(cached));
  } catch {
    // 隐私模式或配额满：缓存只是加速，失败不影响页面。
  }
}

function setDataVersion(next: string): void {
  // 索引更新后旧 manifest 的 `?v=` 已经过期；清掉缓存，后续按新版本重取。
  if (dataVersion && next && dataVersion !== next) {
    manifestResource.clear();
    insightsResource.clear();
    groupSummaryResource.clear();
    groupGalleryResource.clear();
  }
  dataVersion = next;
}

/** 首屏先用上次的索引渲染，避免为了 1.8 KB 的 index.json 空等一个 RTT。 */
export function readCachedDatasetIndex(): DatasetIndex | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(INDEX_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedDatasetIndex;
    if (
      !cached?.index ||
      !Array.isArray(cached.index.datasets) ||
      cached.index.datasets.length === 0
    ) {
      return null;
    }
    if (Date.now() - cached.savedAt > INDEX_CACHE_TTL_MS) return null;
    setDataVersion(cached.index.generatedAt ?? "");
    return cached.index;
  } catch {
    return null;
  }
}

function writeCachedDatasetIndex(index: DatasetIndex): void {
  const store = storage();
  if (!store) return;
  try {
    const cached: CachedDatasetIndex = { savedAt: Date.now(), index };
    store.setItem(INDEX_CACHE_KEY, JSON.stringify(cached));
  } catch {
    // 隐私模式或配额满：缓存只是加速，失败不影响页面。
  }
}

let indexInflight: Promise<DatasetIndex> | null = null;

async function loadDatasetIndex(): Promise<DatasetIndex> {
  const index = await fetchRemoteFirst<DatasetIndex>("index.json", undefined, true);
  if (!Array.isArray(index.datasets) || index.datasets.length === 0) {
    throw new Error("没有可用的成员数据。");
  }
  setDataVersion(index.generatedAt ?? "");
  writeCachedDatasetIndex(index);
  return index;
}

export function fetchDatasetIndex(signal?: AbortSignal): Promise<DatasetIndex> {
  // StrictMode 的两次挂载共用一个请求；失败后清空，下一次重试会重新发。
  if (!indexInflight) {
    indexInflight = loadDatasetIndex().finally(() => {
      indexInflight = null;
    });
  }
  return abortable(indexInflight, signal);
}

export function fetchManifest(datasetId: string, signal?: AbortSignal): Promise<BatchManifest> {
  return manifestResource.fetch(datasetId, signal);
}

export function fetchInsights(
  datasetId: string,
  signal?: AbortSignal,
): Promise<DatasetTotals> {
  return insightsResource.fetch(datasetId, signal);
}

export async function fetchGroupSummary(signal?: AbortSignal): Promise<GroupSummaryFile> {
  const data = await groupSummaryResource.fetch("group", signal);
  writeCachedGroupSummary(data);
  return data;
}

export function fetchGroupGallery(signal?: AbortSignal): Promise<GroupGalleryFile> {
  return groupGalleryResource.fetch("group", signal);
}

/**
 * 路由里已经知道 datasetId 时（`/arale/...`），让 manifest 与 index.json 并行出发。
 * 失败不抛：真正的加载路径会复用同一个去重请求，并按它自己的状态处理错误。
 */
export function prefetchDataset(datasetId: string): void {
  void fetchManifest(datasetId).catch(() => {});
  void fetchInsights(datasetId).catch(() => {});
}

/** 作者 → 场次索引；只有 v2 dataset 才会生成，观众重叠等分析页按需加载。 */
export async function fetchAuthorIndex(
  datasetId: string,
  signal?: AbortSignal,
): Promise<AuthorIndexFile> {
  const file = await fetchRemoteFirst<AuthorIndexFile>(`${datasetId}/authors.json`, signal);
  if (!Array.isArray(file.authors) || !Array.isArray(file.streams)) {
    throw new Error("作者索引不完整。");
  }
  return file;
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
