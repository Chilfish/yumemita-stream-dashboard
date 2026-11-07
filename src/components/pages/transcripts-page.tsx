import { useDatasetView } from "@/components/dashboard/contexts/dataset-view-context";
import { TranscriptsView } from "@/components/dashboard/transcript/transcripts-view";
import { useSearchParams } from "@/lib/router-compat";
import {
  parseTranscriptParams,
  writeTranscriptParams,
  type TranscriptParams,
} from "@/lib/transcript-params";
import type { TranscriptIndexEntry } from "@/lib/transcripts";

export interface TranscriptsPageProps {
  transcripts: TranscriptIndexEntry[];
  error: string | null;
}

export function TranscriptsPage({ transcripts, error }: TranscriptsPageProps) {
  const { dataset } = useDatasetView();
  const [searchParams, setSearchParams] = useSearchParams();
  const params = parseTranscriptParams(searchParams);

  function handleParamsChange(next: TranscriptParams): void {
    // 搜索 / 标签 / 排序 / 密度都走 replace，不污染历史记录。
    setSearchParams(writeTranscriptParams(searchParams, next), { replace: true });
  }

  return (
    <TranscriptsView
      datasetId={dataset.id}
      datasetLabel={dataset.label}
      entries={transcripts}
      error={error}
      onParamsChange={handleParamsChange}
      params={params}
    />
  );
}
