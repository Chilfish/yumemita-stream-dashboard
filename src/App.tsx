import { Info, LayoutDashboard, Mic2, GitCompare, Table2, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { AboutView } from "@/components/dashboard/about-view";
import { AppHeader } from "@/components/dashboard/app-header";
import { CompareView } from "@/components/dashboard/compare-view";
import { OverviewView } from "@/components/dashboard/overview-view";
import { StreamView } from "@/components/dashboard/stream-view";
import { TableView } from "@/components/dashboard/table-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardPanel } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { useDataset } from "@/hooks/use-dataset";
import { useDatasetIndex } from "@/hooks/use-dataset-index";
import { useTheme } from "@/hooks/use-theme";
import { aggregateDataset, buildStreamRows } from "@/lib/aggregate";
import { formatInteger } from "@/lib/format";

const VIEWS = ["overview", "stream", "compare", "table", "about"] as const;
type View = (typeof VIEWS)[number];

function isView(value: unknown): value is View {
  return typeof value === "string" && (VIEWS as readonly string[]).includes(value);
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-10">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton className="h-24 rounded-xl" key={index} />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <p className="text-center text-muted-foreground text-xs">{label}</p>
    </div>
  );
}

export default function App() {
  const { index, loading: indexLoading, error: indexError } = useDatasetIndex();
  const { theme, toggle } = useTheme();
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [view, setView] = useState<View>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 默认 dataset / 默认场次都在渲染时派生，避免 effect 里同步 setState。
  const activeDatasetId = datasetId ?? index?.datasets[0]?.id ?? null;
  const datasetState = useDataset(activeDatasetId);
  const { manifest, packs, status, error, progress } = datasetState;

  const rows = useMemo(
    () => (manifest ? buildStreamRows(manifest, packs) : []),
    [manifest, packs],
  );
  const totals = useMemo(() => aggregateDataset(rows), [rows]);
  const activeSelectedId = selectedId ?? rows[0]?.summary.videoId ?? null;

  const dataset = index?.datasets.find(item => item.id === activeDatasetId) ?? null;

  function openStream(videoId: string): void {
    setSelectedId(videoId);
    setView("stream");
  }

  if (indexLoading) {
    return <LoadingScreen label="正在加载 dataset 索引…" />;
  }

  if (indexError || !index) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <Alert variant="error">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>数据加载失败</AlertTitle>
          <AlertDescription>{indexError ?? "找不到 dataset 索引"}</AlertDescription>
        </Alert>
        <p className="mt-3 text-muted-foreground text-xs">
          先运行 <code>bun run sync:data</code>，确认 <code>public/data/index.json</code> 存在。
        </p>
        <Button className="mt-4" onClick={() => window.location.reload()} type="button">
          重新加载
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <AppHeader
        datasetId={activeDatasetId}
        datasets={index.datasets}
        onDatasetChange={id => {
          setDatasetId(id);
          setSelectedId(null);
        }}
        onToggleTheme={toggle}
        theme={theme}
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
        <main className="mx-auto w-full max-w-[1500px] px-4 py-5">
          <Tabs
            onValueChange={value => {
              if (isView(value)) setView(value);
            }}
            value={view}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <TabsList>
                <TabsTab value="overview">
                  <LayoutDashboard aria-hidden="true" />
                  总览
                </TabsTab>
                <TabsTab value="stream">
                  <Mic2 aria-hidden="true" />
                  单场
                </TabsTab>
                <TabsTab value="compare">
                  <GitCompare aria-hidden="true" />
                  对比
                </TabsTab>
                <TabsTab value="table">
                  <Table2 aria-hidden="true" />
                  数据表
                </TabsTab>
                <TabsTab value="about">
                  <Info aria-hidden="true" />
                  说明
                </TabsTab>
              </TabsList>
              <p className="text-muted-foreground text-xs">
                {rows.length > 0
                  ? `${formatInteger(rows.length)} 场 · ${formatInteger(totals.chatTotal)} 条弹幕`
                  : "没有可用数据"}
              </p>
            </div>

            <TabsPanel className="mt-4" value="overview">
              {view === "overview" && dataset ? (
                <OverviewView
                  dataset={dataset}
                  manifest={manifest}
                  onSelectStream={openStream}
                  rows={rows}
                  totals={totals}
                />
              ) : null}
            </TabsPanel>

            <TabsPanel className="mt-4" value="stream">
              {view === "stream" ? (
                <StreamView onSelect={setSelectedId} rows={rows} selectedId={activeSelectedId} />
              ) : null}
            </TabsPanel>

            <TabsPanel className="mt-4" value="compare">
              {view === "compare" ? <CompareView rows={rows} /> : null}
            </TabsPanel>

            <TabsPanel className="mt-4" value="table">
              {view === "table" ? <TableView onSelect={openStream} rows={rows} /> : null}
            </TabsPanel>

            <TabsPanel className="mt-4" value="about">
              {view === "about" && dataset ? (
                <AboutView dataset={dataset} manifest={manifest} />
              ) : null}
            </TabsPanel>
          </Tabs>

          {rows.length === 0 ? (
            <Card className="mt-4">
              <CardPanel>
                <p className="text-muted-foreground text-sm">
                  没有加载到 datapack。确认 manifest 里的 videoId 与
                  <code>public/data/&lt;dataset&gt;/</code> 下的文件一致。
                </p>
              </CardPanel>
            </Card>
          ) : null}
        </main>
      ) : null}
    </div>
  );
}
