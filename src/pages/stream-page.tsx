import { Link, useNavigate, useParams } from "react-router";
import { useDatasetView } from "@/components/dashboard/dataset-view-context";
import { StreamView } from "@/components/dashboard/stream-view";
import { Button } from "@/components/ui/button";
import { Card, CardPanel } from "@/components/ui/card";
import { findStreamRow } from "@/lib/aggregate";
import { streamPath, viewPath } from "@/lib/routes";

export function StreamPage() {
  const { dataset, rows } = useDatasetView();
  const { videoId } = useParams();
  const navigate = useNavigate();
  const row = findStreamRow(rows, videoId ?? null);

  if (!row) {
    return (
      <Card>
        <CardPanel className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="font-medium text-sm">找不到这场直播</p>
          <p className="text-muted-foreground text-xs">{videoId}</p>
          <Button
            className="mt-2"
            render={<Link to={viewPath(dataset.id, "stream")} />}
            variant="outline"
          >
            返回单场列表
          </Button>
        </CardPanel>
      </Card>
    );
  }

  return (
    <StreamView
      onSelect={nextId => navigate(streamPath(dataset.id, nextId))}
      rows={rows}
      selectedId={row.summary.videoId}
    />
  );
}
