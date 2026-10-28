import { Navigate } from "react-router";
import { useDatasetView } from "@/components/dashboard/dataset-view-context";
import { Card, CardPanel } from "@/components/ui/card";
import { streamPath } from "@/lib/routes";

export function StreamIndexPage() {
  const { dataset, rows } = useDatasetView();
  const latest = rows[0];

  if (!latest) {
    return (
      <Card>
        <CardPanel className="py-12 text-center">
          <p className="text-muted-foreground text-sm">没有可展示的直播</p>
        </CardPanel>
      </Card>
    );
  }

  return <Navigate replace to={streamPath(dataset.id, latest.videoId)} />;
}
