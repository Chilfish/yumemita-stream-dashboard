import { useNavigate } from "react-router";
import { useDatasetView } from "@/components/dashboard/dataset-view-context";
import { TableView } from "@/components/dashboard/table-view";
import { streamPath } from "@/lib/routes";

export function TablePage() {
  const { dataset, rows } = useDatasetView();
  const navigate = useNavigate();

  return (
    <TableView
      onSelect={videoId => navigate(streamPath(dataset.id, videoId))}
      rows={rows}
    />
  );
}
