import { useDatasetView } from "@/components/dashboard/dataset-view-context";
import { TranscriptsView } from "@/components/dashboard/transcripts-view";
import type { TranscriptIndexEntry } from "@/lib/transcripts";

export interface TranscriptsPageProps {
  transcripts: TranscriptIndexEntry[];
  error: string | null;
}

export function TranscriptsPage({ transcripts, error }: TranscriptsPageProps) {
  const { dataset } = useDatasetView();
  return (
    <TranscriptsView
      datasetId={dataset.id}
      datasetLabel={dataset.label}
      entries={transcripts}
      error={error}
    />
  );
}
