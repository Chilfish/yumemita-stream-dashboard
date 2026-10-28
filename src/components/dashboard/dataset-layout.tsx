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
import { buildSummaryRows, findStreamSummary } from "@/lib/aggregate";
import { sectionFromPathname, viewPath } from "@/lib/routes";

export function DatasetLayout() {
  const { datasetId } = useParams();
  const index = useDatasetIndexContext();
  const { pathname } = useLocation();
  const { theme, toggle } = useTheme();

  const dataset = index.datasets.find(item => item.id === datasetId) ?? null;
  const { manifest, totals, status, error } = useDataset(dataset?.id ?? null);

  const rows = useMemo(() => (manifest ? buildSummaryRows(manifest) : []), [manifest]);

  if (!dataset) {
    return <Navigate replace to={viewPath(index.datasets[0].id, "overview")} />;
  }

  const section = sectionFromPathname(pathname);
  const segments = pathname.split("/");
  const stream = section === "stream" ? findStreamSummary(rows, segments[3] ?? null) : null;
  const chatTotal = totals?.chatTotal ?? 0;

  return (
    <SidebarProvider>
      <AppSidebar
        chatTotal={chatTotal}
        dataset={dataset}
        datasets={index.datasets}
        onToggleTheme={toggle}
        streamCount={rows.length || dataset.count}
        theme={theme}
      />

      <SidebarInset>
        <ScrollRestoration />
        <AppHeader
          chatTotal={chatTotal}
          dataset={dataset}
          section={section}
          stream={stream}
          streamCount={rows.length || dataset.count}
        />

        {status === "loading" ? <LoadingScreen label="正在加载 manifest 与聚合摘要…" /> : null}

        {status === "error" ? (
          <div className="mx-auto max-w-2xl px-4 py-16">
            <Alert variant="error">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>数据加载失败</AlertTitle>
              <AlertDescription>{error ?? "未知错误"}</AlertDescription>
            </Alert>
            <Button className="mt-4" onClick={() => window.location.reload()} type="button">
              重新加载
            </Button>
          </div>
        ) : null}

        {status === "ready" && manifest && totals ? (
          <div className="mx-auto w-full max-w-[1500px] px-4 py-5 md:px-6">
            {rows.length === 0 ? (
              <Card className="mb-4">
                <CardPanel>
                  <p className="text-muted-foreground text-sm">
                    没有加载到 manifest。确认 <code>public/data/&lt;dataset&gt;/manifest.json</code>{" "}
                    存在。
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
