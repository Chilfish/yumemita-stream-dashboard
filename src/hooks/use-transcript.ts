import { useCallback, useEffect, useMemo, useState } from "react";
import { REMOTE_DATA_BASE } from "@/lib/data";
import {
  TRANSCRIPT_INDEX_SCHEMA,
  type TranscriptFile,
  type TranscriptIndexEntry,
  type TranscriptIndexFile,
  type TranscriptPayload,
  extractToc,
  normalizeFrontmatter,
  parseTranscriptFile,
  sortTranscriptEntries,
  toIndexEntry,
  transcriptObjectKey,
} from "@/lib/transcripts";

/**
 * 逐字稿运行时数据：远端索引优先，构建期把 `content/transcripts/` 的 Markdown
 * 当离线兜底快照（与 `import.meta.glob` 的语义一致：`/` 开头相对项目根目录）。
 */
const LOCAL_TRANSCRIPT_FILES = import.meta.glob("/content/transcripts/**/*.md", {
  query: "?raw",
  eager: true,
  import: "default",
}) as Record<string, string>;

export type TranscriptStatus = "idle" | "loading" | "ready" | "error";
export type TranscriptFileStatus = "idle" | "loading" | "ready" | "empty" | "error";

interface TranscriptSource {
  entries: TranscriptIndexEntry[];
  source: "remote" | "local";
  error: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class TranscriptMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptMissingError";
  }
}

function abortError(): Error {
  const error = new Error("请求已取消");
  error.name = "AbortError";
  return error;
}

/** 共享缓存里的 Promise 不绑定某个组件的信号；这里只让当前消费者能提前退出。 */
function guard<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// 构建期快照（glob）
// ---------------------------------------------------------------------------

let localFiles: Map<string, TranscriptFile> | null = null;

function localTranscriptMap(): Map<string, TranscriptFile> {
  if (localFiles) return localFiles;
  const map = new Map<string, TranscriptFile>();
  for (const [path, text] of Object.entries(LOCAL_TRANSCRIPT_FILES)) {
    try {
      const file = parseTranscriptFile(String(text ?? ""), path);
      // 根目录下的 README / 模板没有 datasetId，不参与索引。
      if (!file.datasetId) continue;
      map.set(`${file.datasetId}/${file.videoId}`, file);
    } catch {
      // 坏文件由 publish:transcripts 在发布时拦下并报错，浏览器端跳过即可。
    }
  }
  localFiles = map;
  return map;
}

function localIndexEntries(): TranscriptIndexEntry[] {
  const entries = Array.from(localTranscriptMap().values(), file => toIndexEntry(file, ""));
  return sortTranscriptEntries(entries);
}

export function hasLocalTranscript(datasetId: string, videoId: string): boolean {
  return localTranscriptMap().has(`${datasetId}/${videoId}`);
}

// ---------------------------------------------------------------------------
// 远端索引 / 正文
// ---------------------------------------------------------------------------

let indexPromise: Promise<TranscriptSource> | null = null;

async function fetchRemoteIndex(): Promise<TranscriptIndexEntry[]> {
  const response = await fetch(`${REMOTE_DATA_BASE}/transcripts/index.json`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  // 还没发布过逐字稿时远端就是 404，这属于空状态，不是故障。
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error("加载逐字稿列表失败。");
  }
  const file = (await response.json()) as TranscriptIndexFile;
  if (file?.schema !== TRANSCRIPT_INDEX_SCHEMA || !Array.isArray(file.entries)) {
    throw new Error("逐字稿列表格式异常。");
  }
  return file.entries;
}

/**
 * 远端优先：远端不可达或索引为空时回退到构建快照。
 * 两边都没有内容时保留远端错误，索引页才能显示失败原因而不是「还没有逐字稿」。
 */
function loadIndex(force = false): Promise<TranscriptSource> {
  if (force) indexPromise = null;
  if (indexPromise) return indexPromise;

  const local = localIndexEntries();
  if (!REMOTE_DATA_BASE) {
    indexPromise = Promise.resolve({ entries: local, source: "local", error: null });
    return indexPromise;
  }

  indexPromise = fetchRemoteIndex()
    .then(
      (entries): TranscriptSource =>
        entries.length > 0
          ? { entries: sortTranscriptEntries(entries), source: "remote", error: null }
          : { entries: local, source: "local", error: null },
    )
    .catch((error: unknown): TranscriptSource => {
      if (local.length === 0) throw error;
      return { entries: local, source: "local", error: errorMessage(error) };
    })
    .catch((error: unknown) => {
      // 远端和本地都没有内容：让调用方进入错误态，同时允许下一次重试。
      indexPromise = null;
      throw error;
    });

  return indexPromise;
}

function fileFromPayload(payload: TranscriptPayload, fallback: TranscriptFile | null): TranscriptFile {
  const markdown = typeof payload.markdown === "string" ? payload.markdown.trimEnd() : "";
  if (!markdown && fallback) return fallback;
  return {
    datasetId: payload.datasetId || fallback?.datasetId || "",
    videoId: payload.videoId || fallback?.videoId || "",
    frontmatter: payload.frontmatter
      ? normalizeFrontmatter(payload.frontmatter as unknown as Record<string, unknown>)
      : (fallback?.frontmatter ?? normalizeFrontmatter({})),
    markdown,
    toc: extractToc(markdown),
  };
}

const transcriptCache = new Map<string, Promise<TranscriptFile>>();

function loadTranscript(datasetId: string, videoId: string, force = false): Promise<TranscriptFile> {
  const key = `${datasetId}/${videoId}`;
  if (force) transcriptCache.delete(key);
  const cached = transcriptCache.get(key);
  if (cached) return cached;

  const local = localTranscriptMap().get(key) ?? null;
  if (!REMOTE_DATA_BASE) {
    const promise = local
      ? Promise.resolve(local)
      : Promise.reject(new TranscriptMissingError("这场还没有逐字稿"));
    transcriptCache.set(key, promise);
    // 没有远端时失败是确定性的，不必让缓存挡住重试。
    promise.catch(() => transcriptCache.delete(key));
    return promise;
  }

  const promise = fetch(`${REMOTE_DATA_BASE}/${transcriptObjectKey(datasetId, videoId)}`, {
    headers: { Accept: "application/json" },
  })
    .then(async response => {
      if (response.status === 404) {
        throw new TranscriptMissingError("这场还没有逐字稿");
      }
      if (!response.ok) {
        throw new Error("加载逐字稿失败。");
      }
      return (await response.json()) as TranscriptPayload;
    })
    .then(payload => fileFromPayload(payload, local))
    .catch((error: unknown) => {
      // 远端挂掉时构建快照还能读；远端明确说没有也不影响本地兜底。
      if (local) return local;
      throw error;
    })
    .catch((error: unknown) => {
      transcriptCache.delete(key);
      throw error;
    });

  transcriptCache.set(key, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// hooks
// ---------------------------------------------------------------------------

interface IndexState {
  scope: string;
  entries: TranscriptIndexEntry[];
  status: TranscriptStatus;
  error: string | null;
  source: "remote" | "local";
}

const EMPTY_ENTRIES: TranscriptIndexEntry[] = [];

function idleIndexState(): IndexState {
  return { scope: "", entries: EMPTY_ENTRIES, status: "idle", error: null, source: "local" };
}

export interface TranscriptIndexResult {
  entries: TranscriptIndexEntry[];
  status: TranscriptStatus;
  error: string | null;
  source: "remote" | "local";
  /** 当前 dataset 是否已经有这一场的稿；索引还没回来时先看构建快照。 */
  hasTranscript: (videoId: string) => boolean;
  retry: () => void;
}

export function useTranscriptIndex(datasetId: string | null): TranscriptIndexResult {
  const [state, setState] = useState<IndexState>(idleIndexState);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!datasetId) return;
    const controller = new AbortController();
    // oxlint-disable-next-line react/set-state-in-effect -- dataset 变化时必须重置加载状态
    setState({ scope: datasetId, entries: EMPTY_ENTRIES, status: "loading", error: null, source: "local" });

    guard(loadIndex(attempt > 0), controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        setState({
          scope: datasetId,
          entries: result.entries.filter(entry => entry.datasetId === datasetId),
          status: "ready",
          error: result.error,
          source: result.source,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof Error && error.name === "AbortError") return;
        setState({
          scope: datasetId,
          entries: EMPTY_ENTRIES,
          status: "error",
          error: errorMessage(error),
          source: "local",
        });
      });

    return () => controller.abort();
  }, [datasetId, attempt]);

  const current: IndexState =
    !datasetId || state.scope !== datasetId
      ? { scope: datasetId ?? "", entries: EMPTY_ENTRIES, status: datasetId ? "loading" : "idle", error: null, source: "local" }
      : state;

  const videoIds = useMemo(() => new Set(current.entries.map(entry => entry.videoId)), [current.entries]);

  const hasTranscript = useCallback(
    (videoId: string) => {
      if (videoIds.has(videoId)) return true;
      return datasetId ? hasLocalTranscript(datasetId, videoId) : false;
    },
    [datasetId, videoIds],
  );

  const retry = useCallback(() => setAttempt(value => value + 1), []);

  return {
    entries: current.entries,
    status: current.status,
    error: current.error,
    source: current.source,
    hasTranscript,
    retry,
  };
}

interface FileState {
  key: string;
  file: TranscriptFile | null;
  status: TranscriptFileStatus;
  error: string | null;
}

export interface TranscriptResult {
  file: TranscriptFile | null;
  status: TranscriptFileStatus;
  error: string | null;
  retry: () => void;
}

const EMPTY_KEY = "";

export function useTranscript(datasetId: string | null, videoId: string | null): TranscriptResult {
  const key = datasetId && videoId ? `${datasetId}/${videoId}` : EMPTY_KEY;
  const [state, setState] = useState<FileState>({ key: EMPTY_KEY, file: null, status: "idle", error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!datasetId || !videoId) return;
    const controller = new AbortController();
    // oxlint-disable-next-line react/set-state-in-effect -- 切换场次时必须重置加载状态
    setState({ key, file: null, status: "loading", error: null });

    guard(loadTranscript(datasetId, videoId, attempt > 0), controller.signal)
      .then(file => {
        if (controller.signal.aborted) return;
        setState({ key, file, status: "ready", error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof Error && error.name === "AbortError") return;
        if (error instanceof TranscriptMissingError) {
          setState({ key, file: null, status: "empty", error: null });
          return;
        }
        setState({ key, file: null, status: "error", error: errorMessage(error) });
      });

    return () => controller.abort();
  }, [datasetId, videoId, key, attempt]);

  if (!key) return { file: null, status: "idle", error: null, retry: () => undefined };
  if (state.key !== key) {
    return { file: null, status: "loading", error: null, retry: () => setAttempt(value => value + 1) };
  }

  return {
    file: state.file,
    status: state.status,
    error: state.error,
    retry: () => setAttempt(value => value + 1),
  };
}
