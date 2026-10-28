import { TriangleAlert } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  Navigate,
  Outlet,
  ScrollRestoration,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import { AppHeader } from "@/components/dashboard/app-header";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { useDatasetIndexContext } from "@/components/dashboard/dataset-index-context";
import { DatasetViewContext } from "@/components/dashboard/dataset-view-context";
import { LoadingScreen, ViewSkeleton } from "@/components/dashboard/loading-screen";
import { MobileTabBar } from "@/components/dashboard/mobile-tab-bar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useDataset } from "@/hooks/use-dataset";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useTheme } from "@/hooks/use-theme";
import { buildSummaryRows, findStreamSummary } from "@/lib/aggregate";
import { rememberMember } from "@/lib/preferences";
import { homePath, sectionFromPathname, viewPath } from "@/lib/routes";
import type { DatasetIndexEntry } from "@/types/dataset";

const DEFAULT_MEMBER_COLOR = "#b8461f";

export function DatasetLayout() {
  const { datasetId } = useParams();
  const index = useDatasetIndexContext();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const [commandOpen, setCommandOpen] = useState(false);

  const dataset = index.datasets.find(item => item.id === datasetId) ?? null;
  const { manifest, totals, status, error } = useDataset(dataset?.id ?? null);

  const rows = useMemo(() => (manifest ? buildSummaryRows(manifest) : []), [manifest]);
  const openCommandPalette = useCallback(() => setCommandOpen(true), []);

  useKeyboardShortcuts({
    datasetId: dataset?.id ?? null,
    rows,
    onCommandPalette: openCommandPalette,
  });

  useEffect(() => {
    if (dataset) rememberMember(dataset.id);
  }, [dataset]);

  if (!dataset) {
    return <Navigate replace to={homePath(index.datasets[0].id)} />;
  }

  const section = sectionFromPathname(pathname);
  const segments = pathname.split("/");
  const stream = section === "stream" ? findStreamSummary(rows, segments[3] ?? null) : null;
  const chatTotal = totals?.chatTotal ?? 0;

  function handleMemberSelect(next: DatasetIndexEntry): void {
    if (next.id === datasetId) return;
    navigate(viewPath(next.id, section));
  }

  return (
    <SidebarProvider
      style={{ "--member-color": dataset.color ?? DEFAULT_MEMBER_COLOR } as CSSProperties}
    >
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-card focus:px-3 focus:py-2 focus:text-footnote focus:shadow-surface"
        href="#main-content"
        onClick={event => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        跳到主要内容
      </a>
      <AppSidebar
        chatTotal={chatTotal}
        dataset={dataset}
        datasets={index.datasets}
        onToggleTheme={toggle}
        theme={theme}
      />

      <SidebarInset id="main-content" tabIndex={-1}>
        <ScrollRestoration />
        <AppHeader
          chatTotal={chatTotal}
          dataset={dataset}
          onOpenCommand={openCommandPalette}
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
          <div className="mx-auto w-full max-w-[1320px] px-4 pt-6 pb-20 md:px-6 md:pb-6">
            {rows.length === 0 ? (
              <p className="mb-4 text-footnote text-muted-foreground">
                没有加载到 manifest。确认 <code>public/data/&lt;dataset&gt;/manifest.json</code> 存在。
              </p>
            ) : null}
            <DatasetViewContext.Provider value={{ dataset, manifest, rows, totals }}>
              <Suspense fallback={<ViewSkeleton />}>
                <Outlet />
              </Suspense>
            </DatasetViewContext.Provider>
          </div>
        ) : null}

        <MobileTabBar
          activeMemberId={dataset.id}
          activeSection={section}
          datasetId={dataset.id}
          datasets={index.datasets}
          latestVideoId={rows[0]?.videoId ?? null}
          onMemberSelect={handleMemberSelect}
        />

        <CommandPalette
          datasetId={dataset.id}
          datasets={index.datasets}
          onOpenChange={setCommandOpen}
          open={commandOpen}
          rows={rows}
        />
      </SidebarInset>
    </SidebarProvider>
  );
}
