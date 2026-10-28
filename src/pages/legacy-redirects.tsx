import { Navigate, useParams } from "react-router";
import { homePath, streamsPath } from "@/lib/routes";

/** `#/:dataset/overview` 的旧地址。 */
export function LegacyOverviewRedirect() {
  const { datasetId } = useParams();
  return <Navigate replace to={datasetId ? homePath(datasetId) : "/"} />;
}

/** `#/:dataset/table` 的旧地址。 */
export function LegacyTableRedirect() {
  const { datasetId } = useParams();
  return <Navigate replace to={datasetId ? streamsPath(datasetId) : "/"} />;
}
