import { useNavigate } from "react-router";
import { useDatasetView } from "@/components/dashboard/dataset-view-context";
import { MemberHomeView } from "@/components/dashboard/member-home-view";
import { streamPath } from "@/lib/routes";

export function HomePage() {
  const { dataset, manifest, rows, totals } = useDatasetView();
  const navigate = useNavigate();

  return (
    <MemberHomeView
      dataset={dataset}
      manifest={manifest}
      onSelectStream={videoId => navigate(streamPath(dataset.id, videoId))}
      rows={rows}
      totals={totals}
    />
  );
}
