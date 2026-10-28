import { useDatasetView } from "@/components/dashboard/dataset-view-context";
import { MemberHomeView } from "@/components/dashboard/member-home-view";

export function HomePage() {
  const { dataset, manifest, rows, totals } = useDatasetView();

  return <MemberHomeView dataset={dataset} manifest={manifest} rows={rows} totals={totals} />;
}
