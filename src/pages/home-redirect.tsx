import { Navigate } from "react-router";
import { useDatasetIndexContext } from "@/components/dashboard/dataset-index-context";
import { readLastMember } from "@/lib/preferences";
import { homePath } from "@/lib/routes";

export function HomeRedirect() {
  const index = useDatasetIndexContext();
  const last = readLastMember();
  const target =
    index.datasets.find(dataset => dataset.id === last)?.id ?? index.datasets[0].id;
  return <Navigate replace to={homePath(target)} />;
}
