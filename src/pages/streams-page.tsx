import { useSearchParams } from "react-router";
import { useDatasetView } from "@/components/dashboard/dataset-view-context";
import { StreamsView } from "@/components/dashboard/streams-view";
import { type TableParams, parseTableParams, writeTableParams } from "@/lib/table-params";

export function StreamsPage() {
  const { dataset, rows } = useDatasetView();
  const [searchParams, setSearchParams] = useSearchParams();
  const params = parseTableParams(searchParams);

  function handleParamsChange(next: TableParams): void {
    // 搜索 / 筛选 / 排序都走 replace，不污染历史记录。
    setSearchParams(writeTableParams(searchParams, next), { replace: true });
  }

  return (
    <StreamsView
      datasetId={dataset.id}
      onParamsChange={handleParamsChange}
      params={params}
      rows={rows}
    />
  );
}
