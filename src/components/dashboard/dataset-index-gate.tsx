import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Outlet, useMatches } from "react-router";
import { DatasetIndexContext } from "@/components/dashboard/dataset-index-context";
import { LoadingScreen } from "@/components/dashboard/loading-screen";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useDatasetIndex } from "@/hooks/use-dataset-index";
import { prefetchDataset } from "@/lib/data";

export function DatasetIndexGate() {
  const { index, loading, error } = useDatasetIndex();
  // 组级路由没有 `:datasetId`；`useMatches` 同时兼容子路由与 basename 部署。
  const datasetId =
    useMatches()
      .map(match => match.params.datasetId)
      .find(Boolean) ?? null;

  // 索引还没回来就先发 manifest/insights：两者只依赖路由里的 datasetId。
  useEffect(() => {
    if (datasetId) prefetchDataset(datasetId);
  }, [datasetId]);

  if (loading) {
    return <LoadingScreen label="正在加载成员列表…" />;
  }

  if (error || !index) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <Alert variant="error">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>数据加载失败</AlertTitle>
          <AlertDescription>{error ?? "找不到成员列表"}</AlertDescription>
        </Alert>
        <p className="mt-3 text-footnote text-muted-foreground">数据还没有准备好，请稍后重试。</p>
        <Button className="mt-4" onClick={() => window.location.reload()} type="button">
          重新加载
        </Button>
      </div>
    );
  }

  return (
    <DatasetIndexContext.Provider value={index}>
      <Outlet />
    </DatasetIndexContext.Provider>
  );
}
