import { useDatasetView } from "@/components/dashboard/dataset-view-context";
import { AboutView } from "@/components/dashboard/about-view";

export function AboutPage() {
  const { dataset, manifest } = useDatasetView();
  return <AboutView dataset={dataset} manifest={manifest} />;
}
