import { TriangleAlert } from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
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
import { useDatasetIndexContext } from "@/components/dashboard/dataset-index-context";
import { DatasetViewContext } from "@/components/dashboard/dataset-view-context";
import { LoadingScreen, ViewSkeleton } from "@/components/dashboard/loading-screen";
import { MobileTabBar } from "@/components/dashboard/mobile-tab-bar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useDataset } from "@/hooks/use-dataset";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useSeo } from "@/hooks/use-seo";
import { useTheme } from "@/hooks/use-theme";
import { buildSummaryRows, findStreamSummary } from "@/lib/aggregate";
import { memberAccent } from "@/lib/color";
import { thumbnailUrl } from "@/lib/data";
import { rememberMember } from "@/lib/preferences";
import { homePath, sectionFromPathname, viewPath } from "@/lib/routes";
import { buildSeo } from "@/lib/seo";
import { absoluteAssetUrl, siteBasePath, siteOrigin } from "@/lib/site";
import type { DatasetIndexEntry } from "@/types/dataset";

// 命令面板只在第一次按 ⌘K 时才需要；静态导入会把 dialog/输入框塞进入口 chunk。
const CommandPalette = lazy(() =>
  import("@/components/dashboard/command-palette").then(module => ({
    default: module.CommandPalette,
  })),
);

const DEFAULT_MEMBER_COLOR = "#b8461f";

export function DatasetLayout() {
  const { datasetId } = useParams();
  const index = useDatasetIndexContext();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandMounted, setCommandMounted] = useState(false);

  const dataset = index.datasets.find(item => item.id === datasetId) ?? null;
  const { manifest, totals, status, error } = useDataset(dataset?.id ?? null);

  const rows = useMemo(() => (manifest ? buildSummaryRows(manifest) : []), [manifest]);
  // 品牌色本身不做处理（图表、色点用原色）；只有文字/焦点环用小字可读的加深色。
  const memberColor = dataset?.color ?? DEFAULT_MEMBER_COLOR;
  const memberInk = useMemo(() => memberAccent(memberColor, theme), [memberColor, theme]);
  const openCommandPalette = useCallback(() => {
    setCommandMounted(true);
    setCommandOpen(true);
  }, []);

  useKeyboardShortcuts({
    datasetId: dataset?.id ?? null,
    rows,
    onCommandPalette: openCommandPalette,
  });

  useEffect(() => {
    if (dataset) rememberMember(dataset.id);
  }, [dataset]);

  const section = sectionFromPathname(pathname);
  const segments = pathname.split("/");
  const stream = section === "stream" ? findStreamSummary(rows, segments[3] ?? null) : null;
  const latest = rows[0] ?? null;
  const streamMissing = status === "ready" && section === "stream" && !stream;

  const seo = useMemo(() => {
    if (!dataset) return null;
    // 单场页等 manifest 到齐再写 meta，避免把加载态误标成「找不到这场直播」。
    if (section === "stream" && status !== "ready") return null;

    const shareStream = stream ?? latest;
    return buildSeo({
      origin: siteOrigin(),
      basePath: siteBasePath(),
      pathname: streamMissing ? homePath(dataset.id) : pathname,
      section,
      dataset: { id: dataset.id, label: dataset.label, count: dataset.count },
      stream: section === "stream" ? stream : null,
      streamCount: rows.length || dataset.count,
      memberCount: index.datasets.length,
      updatedAt: latest?.startedAt ?? null,
      image: shareStream ? absoluteAssetUrl(thumbnailUrl(dataset.id, shareStream.videoId)) : null,
      notFound: streamMissing,
    });
  }, [
    dataset,
    index.datasets.length,
    latest,
    pathname,
    rows.length,
    section,
    status,
    stream,
    streamMissing,
  ]);

  useSeo(seo);

  if (!dataset) {
    return <Navigate replace to={homePath(index.datasets[0].id)} />;
  }

  const chatTotal = totals?.chatTotal ?? 0;

  function handleMemberSelect(next: DatasetIndexEntry): void {
    if (next.id === datasetId) return;
    navigate(viewPath(next.id, section));
  }

  return (
    <SidebarProvider
      style={
        {
          "--member-color": memberColor,
          "--member-ink": memberInk,
          "--ambient-accent": memberInk,
        } as CSSProperties
      }
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
        section={section}
        theme={theme}
      />

      <SidebarInset className="ambient-field min-w-0" id="main-content" tabIndex={-1}>
        <ScrollRestoration />
        <AppHeader
          chatTotal={chatTotal}
          dataset={dataset}
          onOpenCommand={openCommandPalette}
          section={section}
          stream={stream}
          streamCount={rows.length || dataset.count}
        />

        {status === "loading" ? <LoadingScreen label="正在加载场次数据…" /> : null}

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
          <div className="mx-auto w-full max-w-[82.5rem] px-4 pt-6 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:px-6 md:pb-6">
            {rows.length === 0 ? (
              <p className="mb-4 text-footnote text-muted-foreground">没有加载到场次数据。</p>
            ) : null}
            <DatasetViewContext.Provider value={{ dataset, manifest, rows, totals }}>
              <Suspense fallback={<ViewSkeleton />}>
                {/* 只按「成员 + 栏目」重新挂载：换页时整块视图淡入；
                    同一栏目内部（前后场切换、?view=）不重挂，避免无谓的闪烁。 */}
                <div className="motion-view" key={`${dataset.id}/${section}`}>
                  <Outlet />
                </div>
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

        {commandMounted ? (
          <Suspense fallback={null}>
            <CommandPalette
              datasetId={dataset.id}
              datasets={index.datasets}
              onOpenChange={setCommandOpen}
              open={commandOpen}
              rows={rows}
            />
          </Suspense>
        ) : null}
      </SidebarInset>
    </SidebarProvider>
  );
}
