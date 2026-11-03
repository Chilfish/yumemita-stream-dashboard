import { useSearchParams } from "react-router";
import { CompareView } from "@/components/dashboard/compare-view";
import { useDatasetView } from "@/components/dashboard/dataset-view-context";
import { useStreamPacks } from "@/hooks/use-stream-packs";
import { parseCompareIds, toggleCompareId } from "@/lib/routes";

export function ComparePage() {
  const { dataset, rows } = useDatasetView();
  const [searchParams, setSearchParams] = useSearchParams();

  const hasParam = searchParams.has("ids");
  const urlIds = parseCompareIds(searchParams.get("ids"));
  const validIds = urlIds.filter(id => rows.some(row => row.videoId === id));
  const selectedIds = hasParam ? validIds : rows.slice(0, 3).map(row => row.videoId);
  const { packs, status, error } = useStreamPacks(dataset.id, selectedIds);

  function writeIds(ids: string[]): void {
    const params = new URLSearchParams(searchParams);
    params.set("ids", ids.join(","));
    setSearchParams(params, { replace: true });
  }

  function handleToggle(videoId: string): void {
    writeIds(toggleCompareId(selectedIds, videoId));
  }

  return (
    <CompareView
      datasetLabel={dataset.label}
      onReset={() => writeIds([])}
      onToggle={handleToggle}
      packError={error}
      packStatus={status}
      packs={packs}
      rows={rows}
      selectedIds={selectedIds}
    />
  );
}
