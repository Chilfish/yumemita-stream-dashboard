import { TriangleAlert } from "lucide-react";
import { Suspense, useMemo } from "react";
import { Navigate, Outlet, ScrollRestoration, useLocation, useParams } from "react-router";
import { AppHeader } from "@/components/dashboard/app-header";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { useDatasetIndexContext } from "@/components/dashboard/dataset-index-context";
import { DatasetViewContext } from "@/components/dashboard/dataset-view-context";
import { LoadingScreen, ViewSkeleton } from "@/components/dashboard/loading-screen";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardPanel } from "@/components/ui/card";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useDataset } from "@/hooks/use-dataset";
import { useTheme } from "@/hooks/use-theme";
import { aggregateDataset, buildStreamRows, findStreamRow } from "@/lib/aggregate";
import { sectionFromPathname, viewPath } from "@/lib/routes";

export function DatasetLayout() {
  const { datasetId } = useParams();
  const index = useDatasetIndexContext();
  const { pathname } = useLocation();
  const { theme, toggle } = useTheme();

  const dataset = index.datasets.find(item => item.id === datasetId) ?? null;
  const { manifest, packs, status, error, progress } = useDataset(dataset?.id ?? null);

  const rows = useMemo(
    () => (manifest ? buildStreamRows(manifest, packs) : []),
    [manifest, packs],
  );
  const totals = useMemo(() => aggregateDataset(rows), [rows]);

  if (!dataset) {
    return <Navigate replace to={viewPath(index.datasets[0].id, "overview")} />;
  }

  const section = sectionFromPathname(pathname);
  const segments = pathname.split("/");
  const stream = section === "stream" ? findStreamRow(rows, segments[3] ?? null) : null;

  return (
    <SidebarProvider>
      <AppSidebar
        chatTotal={totals.chatTotal}
        dataset={dataset}
        datasets={index.datasets}
        onToggleTheme={toggle}
        streamCount={rows.length || dataset.count}
        theme={theme}
      />

      <SidebarInset>
        <ScrollRestoration />
        <AppHeader
          chatTotal={totals.chatTotal}
          dataset={dataset}
          section={section}
          stream={stream}
          streamCount={rows.length || dataset.count}
        />

        {status === "loading" ? (
          <LoadingScreen
            label={
              progress.total > 0
                ? `正在加载 datapack ${progress.loaded}/${progress.total}…`
                : "正在加载 manifest…"
            }
          />
        ) : null}

        {status === "error" ? (
          <div className="mx-auto max-w-2xl px-4 py-16">
            <Alert variant="error">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>datapack 加载失败</AlertTitle>
              <AlertDescription>{error ?? "未知错误"}</AlertDescription>
            </Alert>
            <Button className="mt-4" onClick={() => window.location.reload()} type="button">
              重新加载
            </Button>
          </div>
        ) : null}

        {status === "ready" && manifest ? (
          <div className="mx-auto w-full max-w-[1500px] px-4 py-5 md:px-6">
            {rows.length === 0 ? (
              <Card className="mb-4">
                <CardPanel>
                  <p className="text-muted-foreground text-sm">
                    没有加载到 datapack。确认 manifest 里的 videoId 与
                    <code>public/data/&lt;dataset&gt;/</code> 下的文件一致。
                  </p>
                </CardPanel>
              </Card>
            ) : null}
            <DatasetViewContext.Provider value={{ dataset, manifest, rows, totals }}>
              <Suspense fallback={<ViewSkeleton />}>
                <Outlet />
              </Suspense>
            </DatasetViewContext.Provider>
          </div>
        ) : null}
      </SidebarInset>
    </SidebarProvider>
  );
}
