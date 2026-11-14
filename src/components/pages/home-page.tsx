import { useDatasetView } from "@/components/dashboard/contexts/dataset-view-context";
import { MemberHomeView } from "@/components/dashboard/home/member-home-view";

export function HomePage() {
  const { dataset, datasets, manifest, rows, totals } = useDatasetView();

  return (
    <MemberHomeView
      dataset={dataset}
      datasets={datasets}
      manifest={manifest}
      rows={rows}
      totals={totals}
    />
  );
}

