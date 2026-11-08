import { useEffect, useRef, useState } from "react";
import {
  type TranscriptFile,
  type TranscriptPayload,
  extractToc,
  normalizeFrontmatter,
  parseTranscriptFile,
} from "@/lib/transcripts";

/**
 * 逐字稿正文：Worker 代理 R2 读取，浏览器只请求同源 API。
 * 构建期把 `content/transcripts/` 的 Markdown 当离线兜底（Astro dev / R2 不可达时）。
 */
// 只在开发环境打包本地 Markdown：生产构建的 chunk 路径可由 videoId 推导，
// 会员限定场次的正文不能作为静态资源公开。
const LOCAL_TRANSCRIPT_FILES = import.meta.env.DEV
  ? (import.meta.glob("/content/transcripts/**/*.md", {
      query: "?raw",
      import: "default",
    }) as Record<string, () => Promise<string>>)
  : {};

export type TranscriptFileStatus = "idle" | "loading" | "ready" | "empty" | "error";

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

/** `/content/transcripts/<datasetId>/<videoId>.md` → `<datasetId>/<videoId>`。 */
function transcriptKeyFromPath(path: string): string {
  const match = /\/transcripts\/([^/]+)\/([^/]+)\.md$/.exec(path);
  return match ? `${match[1]}/${match[2]}` : "";
}

const LOCAL_TRANSCRIPTS = new Map<string, { path: string; load: () => Promise<string> }>();

for (const [path, load] of Object.entries(LOCAL_TRANSCRIPT_FILES)) {
  const key = transcriptKeyFromPath(path);
  if (key) LOCAL_TRANSCRIPTS.set(key, { path, load });
}

const localFileCache = new Map<string, Promise<TranscriptFile>>();

function loadLocalFile(key: string): Promise<TranscriptFile> | null {
  const entry = LOCAL_TRANSCRIPTS.get(key);
  if (!entry) return null;
  const cached = localFileCache.get(key);
  if (cached) return cached;

  const promise = entry.load().then(text => parseTranscriptFile(String(text ?? ""), entry.path));
  localFileCache.set(key, promise);
  promise.catch(() => localFileCache.delete(key));
  return promise;
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
/** 已解析的正文：切换场次时可以直接显示，不必先闪一帧骨架。 */
const resolvedTranscriptCache = new Map<string, TranscriptFile>();

function loadTranscript(datasetId: string, videoId: string, force = false): Promise<TranscriptFile> {
  const key = `${datasetId}/${videoId}`;
  if (force) {
    transcriptCache.delete(key);
    localFileCache.delete(key);
    resolvedTranscriptCache.delete(key);
  }
  const cached = transcriptCache.get(key);
  if (cached) return cached;

  const loadLocal = (): Promise<TranscriptFile | null> =>
    loadLocalFile(key)?.catch(() => null) ?? Promise.resolve(null);

  const request = fetch(
    `/api/transcripts/${encodeURIComponent(datasetId)}/${encodeURIComponent(videoId)}`,
    { headers: { Accept: "application/json" } },
  )
    .then(async response => {
      if (response.status === 404) {
        const local = await loadLocal();
        if (local) return local;
        throw new TranscriptMissingError("这场还没有逐字稿");
      }
      if (!response.ok) throw new Error("逐字稿暂时不可用。");
      const payload = (await response.json()) as TranscriptPayload;
      const markdown = typeof payload.markdown === "string" ? payload.markdown.trimEnd() : "";
      return fileFromPayload(payload, markdown ? null : await loadLocal());
    })
    .then((file) => {
      resolvedTranscriptCache.set(key, file);
      return file;
    })
    .catch(async (error: unknown) => {
      // 开发环境没有 R2 或 Worker 暂时不可达时，构建快照还能读。
      const local = await loadLocal();
      if (local) return local;
      throw error;
    })
    .catch((error: unknown) => {
      transcriptCache.delete(key);
      throw error;
    });

  transcriptCache.set(key, request);
  return request;
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
  // force 只作用于紧随其后的一次请求；重试成功后共享缓存重新生效。
  const forceNextRef = useRef(false);

  useEffect(() => {
    if (!datasetId || !videoId) return;
    const controller = new AbortController();
    const force = forceNextRef.current;
    forceNextRef.current = false;
    // oxlint-disable-next-line react/set-state-in-effect -- 切换场次时必须重置加载状态
    setState({ key, file: null, status: "loading", error: null });

    guard(loadTranscript(datasetId, videoId, force), controller.signal)
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

  const retry = (): void => {
    forceNextRef.current = true;
    setAttempt(value => value + 1);
  };

  if (!key) return { file: null, status: "idle", error: null, retry: () => undefined };
  // 在渲染期同步到新 key：命中已解析缓存时直接显示正文，否则立刻进入 loading，
  // 不再先返回上一场的数据或额外闪一帧骨架。
  if (state.key !== key) {
    const cached = resolvedTranscriptCache.get(key) ?? null;
    setState({
      key,
      file: cached,
      status: cached ? "ready" : "loading",
      error: null,
    });
    return { file: cached, status: cached ? "ready" : "loading", error: null, retry };
  }

  return {
    file: state.file,
    status: state.status,
    error: state.error,
    retry,
  };
}
