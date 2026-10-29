import { useDatasetView } from "@/components/dashboard/dataset-view-context";
import { TrendsView } from "@/components/dashboard/trends-view";

export function TrendsPage() {
  const { rows, totals } = useDatasetView();
  return <TrendsView rows={rows} totals={totals} />;
}
