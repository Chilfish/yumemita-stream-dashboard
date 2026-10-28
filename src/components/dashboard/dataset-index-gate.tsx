import { TriangleAlert } from "lucide-react";
import { Outlet } from "react-router";
import { DatasetIndexContext } from "@/components/dashboard/dataset-index-context";
import { LoadingScreen } from "@/components/dashboard/loading-screen";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useDatasetIndex } from "@/hooks/use-dataset-index";

export function DatasetIndexGate() {
  const { index, loading, error } = useDatasetIndex();

  if (loading) {
    return <LoadingScreen label="正在加载 dataset 索引…" />;
  }

  if (error || !index) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <Alert variant="error">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>数据加载失败</AlertTitle>
          <AlertDescription>{error ?? "找不到 dataset 索引"}</AlertDescription>
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
    <DatasetIndexContext.Provider value={index}>
      <Outlet />
    </DatasetIndexContext.Provider>
  );
}
