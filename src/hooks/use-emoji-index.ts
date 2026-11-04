import { useEffect, useMemo, useState } from "react";
import { fetchEmojiIndex } from "@/lib/media";

/** 频道表情 id → 名称；失败或还没发布时返回空表，页面退回 id / 占位。 */
export function useEmojiIndex(datasetId: string): Map<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    fetchEmojiIndex(datasetId)
      .then((value) => {
        if (active) setNames(value);
      })
      .catch(() => {
        // 没跑过 fetch:emoji 的 dataset 没有索引，按未知表情处理。
      });
    return () => {
      active = false;
    };
  }, [datasetId]);

  return useMemo(() => new Map(Object.entries(names)), [names]);
}
