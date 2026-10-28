import { useEffect, useState } from "react";
import { fetchManifest, loadDatapacks } from "@/lib/data";
import type { StreamDatapack } from "@/types/datapack";
import type { BatchManifest } from "@/types/dataset";

export type DatasetStatus = "idle" | "loading" | "ready" | "error";

interface DatasetState {
  datasetId: string | null;
  manifest: BatchManifest | null;
  packs: Map<string, StreamDatapack>;
  status: DatasetStatus;
  error: string | null;
  progress: { loaded: number; total: number };
}

const EMPTY_PACKS = new Map<string, StreamDatapack>();

export function useDataset(datasetId: string | null): DatasetState {
  const [state, setState] = useState<DatasetState>({
    datasetId: null,
    manifest: null,
    packs: EMPTY_PACKS,
    status: "idle",
    error: null,
    progress: { loaded: 0, total: 0 },
  });

  useEffect(() => {
    if (!datasetId) return;

    const controller = new AbortController();
    const id = datasetId;
    // oxlint-disable-next-line react/set-state-in-effect -- dataset 切换时必须重置异步状态
    setState({
      datasetId: id,
      manifest: null,
      packs: EMPTY_PACKS,
      status: "loading",
      error: null,
      progress: { loaded: 0, total: 0 },
    });

    async function run(): Promise<void> {
      try {
        const manifest = await fetchManifest(id, controller.signal);
        if (controller.signal.aborted) return;
        setState(current => ({
          ...current,
          manifest,
          progress: { loaded: 0, total: manifest.streams.length },
        }));
        const packs = await loadDatapacks(
          id,
          manifest,
          (loaded, total) => {
            if (!controller.signal.aborted) {
              setState(current => ({ ...current, progress: { loaded, total } }));
            }
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setState(current => ({ ...current, packs, status: "ready" }));
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setState(current => ({
          ...current,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }

    void run();
    return () => controller.abort();
  }, [datasetId]);

  if (!datasetId) {
    return {
      datasetId: null,
      manifest: null,
      packs: EMPTY_PACKS,
      status: "idle",
      error: null,
      progress: { loaded: 0, total: 0 },
    };
  }

  // dataset 刚切换、effect 还没跑时，不要返回上一份 dataset 的数据。
  if (state.datasetId !== datasetId) {
    return {
      datasetId,
      manifest: null,
      packs: EMPTY_PACKS,
      status: "loading",
      error: null,
      progress: { loaded: 0, total: 0 },
    };
  }

  return state;
}
