import { useDatasetView } from "@/components/dashboard/contexts/dataset-view-context";
import { TrendsView } from "@/components/dashboard/trends/trends-view";

export function TrendsPage() {
  const { rows, totals } = useDatasetView();
  return <TrendsView rows={rows} totals={totals} />;
}

