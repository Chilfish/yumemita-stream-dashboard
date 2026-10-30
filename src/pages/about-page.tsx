import { useDatasetView } from "@/components/dashboard/dataset-view-context";
import { AboutView } from "@/components/dashboard/about-view";

export function AboutPage() {
  const { dataset, manifest, totals } = useDatasetView();
  return <AboutView dataset={dataset} manifest={manifest} totals={totals} />;
}
