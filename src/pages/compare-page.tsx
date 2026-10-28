import { useSearchParams } from "react-router";
import { CompareView } from "@/components/dashboard/compare-view";
import { useDatasetView } from "@/components/dashboard/dataset-view-context";
import { parseCompareIds, toggleCompareId } from "@/lib/routes";

export function ComparePage() {
  const { rows } = useDatasetView();
  const [searchParams, setSearchParams] = useSearchParams();

  const hasParam = searchParams.has("ids");
  const urlIds = parseCompareIds(searchParams.get("ids"));
  const validIds = urlIds.filter(id => rows.some(row => row.summary.videoId === id));
  const selectedIds = hasParam
    ? validIds
    : rows.slice(0, 3).map(row => row.summary.videoId);

  function handleToggle(videoId: string): void {
    const next = toggleCompareId(selectedIds, videoId);
    const params = new URLSearchParams(searchParams);
    params.set("ids", next.join(","));
    setSearchParams(params, { replace: true });
  }

  return <CompareView onToggle={handleToggle} rows={rows} selectedIds={selectedIds} />;
}
