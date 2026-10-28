import { useEffect, useState } from "react";
import { fetchDatasetIndex } from "@/lib/data";
import type { DatasetIndex } from "@/types/dataset";

interface DatasetIndexState {
  index: DatasetIndex | null;
  loading: boolean;
  error: string | null;
}

export function useDatasetIndex(): DatasetIndexState {
  const [state, setState] = useState<DatasetIndexState>({
    index: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    fetchDatasetIndex(controller.signal)
      .then(index => {
        if (!controller.signal.aborted) {
          setState({ index, loading: false, error: null });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          index: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => controller.abort();
  }, []);

  return state;
}
