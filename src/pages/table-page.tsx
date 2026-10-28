import { useNavigate, useSearchParams } from "react-router";
import { useDatasetView } from "@/components/dashboard/dataset-view-context";
import { TableView } from "@/components/dashboard/table-view";
import { streamPath } from "@/lib/routes";
import { type TableParams, parseTableParams, writeTableParams } from "@/lib/table-params";

export function TablePage() {
  const { dataset, rows } = useDatasetView();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const params = parseTableParams(searchParams);

  function handleParamsChange(next: TableParams): void {
    setSearchParams(writeTableParams(searchParams, next), { replace: true });
  }

  return (
    <TableView
      onParamsChange={handleParamsChange}
      onSelect={videoId => navigate(streamPath(dataset.id, videoId))}
      params={params}
      rows={rows}
    />
  );
}
