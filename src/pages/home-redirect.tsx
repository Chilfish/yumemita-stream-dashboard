import { Navigate } from "react-router";
import { useDatasetIndexContext } from "@/components/dashboard/dataset-index-context";
import { viewPath } from "@/lib/routes";

export function HomeRedirect() {
  const index = useDatasetIndexContext();
  return <Navigate replace to={viewPath(index.datasets[0].id, "overview")} />;
}
