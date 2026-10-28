import { createContext, useContext } from "react";
import type { DatasetTotals, StreamRow } from "@/lib/aggregate";
import type { BatchManifest, DatasetIndexEntry } from "@/types/dataset";

export interface DatasetViewValue {
  dataset: DatasetIndexEntry;
  manifest: BatchManifest;
  rows: StreamRow[];
  totals: DatasetTotals;
}

export const DatasetViewContext = createContext<DatasetViewValue | null>(null);

export function useDatasetView(): DatasetViewValue {
  const value = useContext(DatasetViewContext);
  if (!value) {
    throw new Error("useDatasetView must be used within DatasetViewContext.Provider");
  }
  return value;
}
