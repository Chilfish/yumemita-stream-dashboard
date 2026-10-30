import { useEffect, useState } from "react";
import { fetchDatasetIndex, readCachedDatasetIndex } from "@/lib/data";
import type { DatasetIndex } from "@/types/dataset";

interface DatasetIndexState {
  index: DatasetIndex | null;
  loading: boolean;
  error: string | null;
}

export function useDatasetIndex(): DatasetIndexState {
  const [state, setState] = useState<DatasetIndexState>(() => {
    const index = readCachedDatasetIndex();
    return index
      ? { index, loading: false, error: null }
      : { index: null, loading: true, error: null };
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
        // 有缓存时继续用旧索引：后台校验失败不应该把已经能看的页面换成错误页。
        setState(previous =>
          previous.index
            ? { ...previous, loading: false }
            : {
                index: null,
                loading: false,
                error: error instanceof Error ? error.message : String(error),
              },
        );
      });

    return () => controller.abort();
  }, []);

  return state;
}
