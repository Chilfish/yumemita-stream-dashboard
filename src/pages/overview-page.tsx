import { useNavigate } from "react-router";
import { useDatasetView } from "@/components/dashboard/dataset-view-context";
import { OverviewView } from "@/components/dashboard/overview-view";
import { streamPath } from "@/lib/routes";

export function OverviewPage() {
  const { dataset, manifest, rows, totals } = useDatasetView();
  const navigate = useNavigate();

  return (
    <OverviewView
      dataset={dataset}
      manifest={manifest}
      onSelectStream={videoId => navigate(streamPath(dataset.id, videoId))}
      rows={rows}
      totals={totals}
    />
  );
}
