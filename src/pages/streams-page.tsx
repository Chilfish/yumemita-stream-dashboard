import { useNavigate, useSearchParams } from "react-router";
import { useDatasetView } from "@/components/dashboard/dataset-view-context";
import { StreamsView } from "@/components/dashboard/streams-view";
import { streamPath } from "@/lib/routes";
import { type TableParams, parseTableParams, writeTableParams } from "@/lib/table-params";

export function StreamsPage() {
  const { dataset, rows } = useDatasetView();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const params = parseTableParams(searchParams);

  function handleParamsChange(next: TableParams): void {
    setSearchParams(writeTableParams(searchParams, next), { replace: true });
  }

  return (
    <StreamsView
      onParamsChange={handleParamsChange}
      onSelect={videoId => navigate(streamPath(dataset.id, videoId))}
      params={params}
      rows={rows}
    />
  );
}
