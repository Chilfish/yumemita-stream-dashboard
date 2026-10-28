import { TriangleAlert } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useDatasetView } from "@/components/dashboard/dataset-view-context";
import { ViewSkeleton } from "@/components/dashboard/loading-screen";
import { StreamDetailView } from "@/components/dashboard/stream-detail-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardPanel } from "@/components/ui/card";
import { useStreamPacks } from "@/hooks/use-stream-packs";
import { findStreamSummary } from "@/lib/aggregate";
import { parseStreamSubView, streamPath, streamsPath, type StreamSubView } from "@/lib/routes";

export function StreamPage() {
  const { dataset, rows } = useDatasetView();
  const { videoId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const view = parseStreamSubView(searchParams.get("view"));
  const summary = findStreamSummary(rows, videoId ?? null);
  const { packs, status, error } = useStreamPacks(
    dataset.id,
    summary ? [summary.videoId] : [],
  );

  if (!summary) {
    return (
      <Card>
        <CardPanel className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="font-medium text-sm">找不到这场直播</p>
          <p className="text-muted-foreground text-xs">{videoId}</p>
          <Button
            className="mt-2"
            render={<Link to={streamsPath(dataset.id)} />}
            variant="outline"
          >
            返回场次列表
          </Button>
        </CardPanel>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card>
        <CardPanel className="flex flex-col items-start gap-3 py-8">
          <Alert variant="error">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>单场数据加载失败</AlertTitle>
            <AlertDescription>{error ?? "未知错误"}</AlertDescription>
          </Alert>
          <Button onClick={() => window.location.reload()} type="button" variant="outline">
            重新加载
          </Button>
        </CardPanel>
      </Card>
    );
  }

  const pack = packs.get(summary.videoId);
  if (!pack) {
    return <ViewSkeleton />;
  }

  const currentVideoId = summary.videoId;

  // 子视图只改 `?view=`，默认值不出现在 URL 里；用 replace 避免污染历史记录。
  function handleViewChange(next: StreamSubView): void {
    navigate(streamPath(dataset.id, currentVideoId, next), { replace: true });
  }

  return (
    <StreamDetailView
      onSelect={nextId => navigate(streamPath(dataset.id, nextId))}
      onViewChange={handleViewChange}
      row={{ summary, pack }}
      rows={rows}
      view={view}
    />
  );
}
