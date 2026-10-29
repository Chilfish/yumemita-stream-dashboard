import { Link } from "react-router";
import { useDatasetView } from "@/components/dashboard/dataset-view-context";
import { GalleryView } from "@/components/dashboard/gallery-view";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { streamsPath } from "@/lib/routes";

export function GalleryPage() {
  const { dataset, rows } = useDatasetView();
  const latest = rows[0] ?? null;

  const eyebrow =
    rows.length > 0 && latest
      ? `${rows.length} 场 · 最近 ${formatDate(latest.startedAt)}`
      : "还没有场次";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        actions={
          <Button render={<Link to={streamsPath(dataset.id)} />} size="sm" variant="outline">
            按表格浏览
          </Button>
        }
        eyebrow={eyebrow}
        title="相册"
      />
      <GalleryView datasetId={dataset.id} rows={rows} />
    </div>
  );
}
