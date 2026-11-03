import { useDatasetView } from "@/components/dashboard/dataset-view-context";
import { TranscriptsView } from "@/components/dashboard/transcripts-view";

export function TranscriptsPage() {
  const { dataset } = useDatasetView();
  return <TranscriptsView datasetId={dataset.id} datasetLabel={dataset.label} />;
}
