import { useMemo } from "react";
import { Link } from "react-router";
import { useDatasetView } from "@/components/dashboard/dataset-view-context";
import { GalleryView, type GalleryRow } from "@/components/dashboard/gallery-view";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { streamsPath } from "@/lib/routes";

export function GalleryPage() {
  const { dataset, rows } = useDatasetView();
  const latest = rows[0] ?? null;

  // 相册只认行自带的 datasetId：单成员页把成员 id 补到每一行上，和全组页同构。
  const galleryRows: GalleryRow[] = useMemo(
    () => rows.map(row => ({ ...row, datasetId: dataset.id })),
    [rows, dataset.id],
  );

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
      <GalleryView rows={galleryRows} />
    </div>
  );
}
