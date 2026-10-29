import { useEffect, useState } from "react";
import { fetchManifest } from "@/lib/data";
import { buildGroupData, type GroupData } from "@/lib/group";
import type { DatasetIndexEntry } from "@/types/dataset";

export type GroupStatus = "loading" | "ready" | "error";

interface GroupDataState {
  data: GroupData | null;
  status: GroupStatus;
  error: string | null;
  /** 单个成员加载失败时页面仍然可用，这里只用于提示。 */
  failedMembers: string[];
}

const EMPTY: GroupDataState = {
  data: null,
  status: "loading",
  error: null,
  failedMembers: [],
};

/**
 * 组级视图只拉五份 manifest，不拉 insights 与 datapack。
 * 单个成员的 manifest 失败不阻塞其余成员；全部失败才算错误。
 */
export function useGroupData(datasets: DatasetIndexEntry[]): GroupDataState {
  const [state, setState] = useState<GroupDataState>(EMPTY);
  const key = datasets.map(dataset => dataset.id).join(",");

  useEffect(() => {
    if (datasets.length === 0) return;

    const controller = new AbortController();
    // oxlint-disable-next-line react/set-state-in-effect -- 成员集合变化时必须重置异步状态
    setState({ ...EMPTY, status: "loading" });

    async function run(): Promise<void> {
      const results = await Promise.allSettled(
        datasets.map(dataset => fetchManifest(dataset.id, controller.signal)),
      );
      if (controller.signal.aborted) return;

      const manifests = new Map<string, Awaited<ReturnType<typeof fetchManifest>>>();
      const failedMembers: string[] = [];

      results.forEach((result, index) => {
        const dataset = datasets[index];
        if (!dataset) return;
        if (result.status === "fulfilled") manifests.set(dataset.id, result.value);
        else failedMembers.push(dataset.label);
      });

      if (manifests.size === 0) {
        setState({
          data: null,
          status: "error",
          error: "成员数据全部加载失败，请稍后重试。",
          failedMembers,
        });
        return;
      }

      setState({
        data: buildGroupData(datasets, manifests),
        status: "ready",
        error: null,
        failedMembers,
      });
    }

    void run();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key 覆盖了 datasets 的成员集合
  }, [key]);

  return state;
}
