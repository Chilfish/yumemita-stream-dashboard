import { createContext, useContext } from "react";
import type { DatasetIndex } from "@/types/dataset";

export const DatasetIndexContext = createContext<DatasetIndex | null>(null);

export function useDatasetIndexContext(): DatasetIndex {
  const index = useContext(DatasetIndexContext);
  if (!index) {
    throw new Error("useDatasetIndexContext must be used within DatasetIndexContext.Provider");
  }
  return index;
}
