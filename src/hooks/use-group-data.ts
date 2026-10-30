import { useEffect, useState } from "react";
import {
  fetchGroupGallery,
  fetchGroupSummary,
  fetchManifest,
  readCachedGroupSummary,
} from "@/lib/data";
import {
  buildGroupData,
  buildGroupDataFromStreams,
  buildGroupDataFromSummary,
  type GroupData,
} from "@/lib/group";
import type { BatchManifest, DatasetIndexEntry } from "@/types/dataset";

export type GroupStatus = "loading" | "ready" | "error";
export type GroupDataMode = "summary" | "full";

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
 * 组首页只拉 `group-summary.json`（stats + 最新/最近若干行），
 * 全组相册才拉 `group-gallery.json` 的全部精简行。
 * 远端还是旧数据、两个文件都不存在时，回退到逐成员 manifest。
 */
export function useGroupData(
  datasets: DatasetIndexEntry[],
  mode: GroupDataMode = "summary",
): GroupDataState {
  const [state, setState] = useState<GroupDataState>(EMPTY);
  const key = `${mode}|${datasets.map(dataset => dataset.id).join(",")}`;

  useEffect(() => {
    if (datasets.length === 0) return;

    const controller = new AbortController();
    const cached = mode === "summary" ? readCachedGroupSummary() : null;

    // oxlint-disable-next-line react/set-state-in-effect -- 成员集合 / 栏目变化时必须重置异步状态
    setState(
      cached
        ? {
            data: buildGroupDataFromSummary(datasets, cached),
            status: "ready",
            error: null,
            failedMembers: [],
          }
        : { ...EMPTY, status: "loading" },
    );

    async function fallback(): Promise<void> {
      const results = await Promise.allSettled(
        datasets.map(dataset => fetchManifest(dataset.id, controller.signal)),
      );
      if (controller.signal.aborted) return;

      const manifests = new Map<string, BatchManifest>();
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

    async function run(): Promise<void> {
      try {
        const data =
          mode === "summary"
            ? buildGroupDataFromSummary(datasets, await fetchGroupSummary(controller.signal))
            : buildGroupDataFromStreams(
                datasets,
                (await fetchGroupGallery(controller.signal)).streams,
              );
        if (controller.signal.aborted) return;
        setState({ data, status: "ready", error: null, failedMembers: [] });
      } catch {
        if (controller.signal.aborted) return;
        // 已经有可用的缓存时，后台校验失败不把页面换掉。
        if (cached) return;
        void fallback().catch((fallbackError: unknown) => {
          if (controller.signal.aborted) return;
          setState({
            data: null,
            status: "error",
            error:
              fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            failedMembers: [],
          });
        });
      }
    }

    void run();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key 覆盖了 mode 与成员集合
  }, [key]);

  return state;
}
