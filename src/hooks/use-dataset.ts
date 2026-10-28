import { useEffect, useState } from "react";
import { fetchInsights, fetchManifest } from "@/lib/data";
import type { DatasetTotals } from "@/lib/aggregate";
import type { BatchManifest } from "@/types/dataset";

export type DatasetStatus = "idle" | "loading" | "ready" | "error";

interface DatasetState {
  datasetId: string | null;
  manifest: BatchManifest | null;
  totals: DatasetTotals | null;
  status: DatasetStatus;
  error: string | null;
}

const EMPTY_STATE: DatasetState = {
  datasetId: null,
  manifest: null,
  totals: null,
  status: "idle",
  error: null,
};

export function useDataset(datasetId: string | null): DatasetState {
  const [state, setState] = useState<DatasetState>(EMPTY_STATE);

  useEffect(() => {
    if (!datasetId) return;

    const controller = new AbortController();
    const id = datasetId;
    // oxlint-disable-next-line react/set-state-in-effect -- dataset 切换时必须重置异步状态
    setState({
      datasetId: id,
      manifest: null,
      totals: null,
      status: "loading",
      error: null,
    });

    async function run(): Promise<void> {
      try {
        const [manifest, totals] = await Promise.all([
          fetchManifest(id, controller.signal),
          fetchInsights(id, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setState({
          datasetId: id,
          manifest,
          totals,
          status: "ready",
          error: null,
        });
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setState({
          datasetId: id,
          manifest: null,
          totals: null,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    void run();
    return () => controller.abort();
  }, [datasetId]);

  if (!datasetId) return EMPTY_STATE;

  // dataset 刚切换、effect 还没跑时，不要返回上一份 dataset 的数据。
  if (state.datasetId !== datasetId) {
    return { ...EMPTY_STATE, datasetId, status: "loading" };
  }

  return state;
}
