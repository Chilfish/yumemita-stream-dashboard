import { useEffect, useState } from "react";
import { fetchDatapack } from "@/lib/data";
import type { StreamDatapack } from "@/types/datapack";

export type PackStatus = "idle" | "loading" | "ready" | "error";

interface PackState {
  key: string;
  packs: Map<string, StreamDatapack>;
  status: PackStatus;
  error: string | null;
}

const EMPTY_PACKS = new Map<string, StreamDatapack>();

function idleState(): PackState {
  return { key: "", packs: EMPTY_PACKS, status: "idle", error: null };
}

export function useStreamPacks(
  datasetId: string | null,
  videoIds: string[],
): Pick<PackState, "packs" | "status" | "error"> {
  const idKey = videoIds.join(",");
  const key = datasetId ? `${datasetId}|${idKey}` : "";

  const [state, setState] = useState<PackState>(idleState);

  useEffect(() => {
    if (!datasetId || !idKey) return;

    const controller = new AbortController();
    const ids = idKey.split(",").filter(Boolean);
    // oxlint-disable-next-line react/set-state-in-effect -- 选中场次变化时必须重置加载状态
    setState({ key, packs: EMPTY_PACKS, status: "loading", error: null });

    Promise.all(
      ids.map(async videoId => {
        const pack = await fetchDatapack(datasetId, videoId);
        return [videoId, pack] as const;
      }),
    )
      .then(entries => {
        if (controller.signal.aborted) return;
        setState({ key, packs: new Map(entries), status: "ready", error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          key,
          packs: EMPTY_PACKS,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => controller.abort();
  }, [datasetId, idKey, key]);

  if (!datasetId || !idKey) return { packs: EMPTY_PACKS, status: "idle", error: null };
  if (state.key !== key) return { packs: EMPTY_PACKS, status: "loading", error: null };
  return state;
}
