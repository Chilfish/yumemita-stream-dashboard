import type { DatasetIndexEntry, StreamSummary } from "@/types/dataset";

/**
 * 一场直播的全部成员标签，频道主在前、参与者在后。
 * 单人场只返回一项；旧数据没有 `participants` 时行为与改造前一致。
 */
export function memberLabelsOf(
  stream: Pick<StreamSummary, "datasetId" | "participants">,
  datasets: Pick<DatasetIndexEntry, "id" | "label">[],
): string[] {
  const labelOf = (id: string) => datasets.find(dataset => dataset.id === id)?.label ?? id;
  const ids = [stream.datasetId, ...(stream.participants ?? [])].filter(
    (id): id is string => Boolean(id),
  );
  return [...new Set(ids)].map(labelOf);
}
