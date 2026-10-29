import { TriangleAlert } from "lucide-react";
import { Suspense } from "react";
import { Outlet, ScrollRestoration, useLocation, useNavigate } from "react-router";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { useDatasetIndexContext } from "@/components/dashboard/dataset-index-context";
import { GroupDataContext } from "@/components/dashboard/group-data-context";
import { GroupHeader } from "@/components/dashboard/group-header";
import { LoadingScreen, ViewSkeleton } from "@/components/dashboard/loading-screen";
import { MobileTabBar } from "@/components/dashboard/mobile-tab-bar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useGroupData } from "@/hooks/use-group-data";
import { useTheme } from "@/hooks/use-theme";
import { groupSectionFromPathname, homePath } from "@/lib/routes";

export function GroupLayout() {
  const index = useDatasetIndexContext();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const { data, status, error, failedMembers } = useGroupData(index.datasets);

  const section = groupSectionFromPathname(pathname);
  const chatTotal = data?.totals.chatTotal ?? 0;
  const streamCount =
    data?.totals.streamCount ?? index.datasets.reduce((sum, item) => sum + item.count, 0);

  return (
    <SidebarProvider>
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
        dataset={null}
        datasets={index.datasets}
        onToggleTheme={toggle}
        section={section}
        theme={theme}
      />

      <SidebarInset className="min-w-0" id="main-content" tabIndex={-1}>
        <ScrollRestoration />
        <GroupHeader
          chatTotal={chatTotal}
          memberCount={index.datasets.length}
          section={section}
          streamCount={streamCount}
        />

        {status === "loading" ? <LoadingScreen label="正在加载全组场次…" /> : null}

        {status === "error" ? (
          <div className="mx-auto max-w-2xl px-4 py-16">
            <Alert variant="error">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>数据加载失败</AlertTitle>
              <AlertDescription>{error ?? "未知错误"}</AlertDescription>
            </Alert>
          </div>
        ) : null}

        {status === "ready" && data ? (
          <div className="mx-auto w-full max-w-[82.5rem] px-4 pt-6 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:px-6 md:pb-6">
            {failedMembers.length > 0 ? (
              <p className="mb-4 text-footnote text-muted-foreground">
                以下成员的数据加载失败，已跳过：{failedMembers.join("、")}。
              </p>
            ) : null}
            <GroupDataContext.Provider value={data}>
              <Suspense fallback={<ViewSkeleton />}>
                <Outlet />
              </Suspense>
            </GroupDataContext.Provider>
          </div>
        ) : null}

        <MobileTabBar
          activeMemberId={null}
          activeSection={section}
          datasetId={null}
          datasets={index.datasets}
          latestVideoId={null}
          onMemberSelect={member => navigate(homePath(member.id))}
        />
      </SidebarInset>
    </SidebarProvider>
  );
}
