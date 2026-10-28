import { createHashRouter, Navigate } from "react-router";
import { DatasetIndexGate } from "@/components/dashboard/dataset-index-gate";
import { DatasetLayout } from "@/components/dashboard/dataset-layout";
import { RouteError } from "@/components/dashboard/route-error";
import { HomeRedirect } from "@/pages/home-redirect";
import {
  AboutPage,
  ComparePage,
  OverviewPage,
  StreamIndexPage,
  StreamPage,
  TablePage,
} from "@/pages/lazy-pages";

export const router = createHashRouter([
  {
    path: "/",
    element: <DatasetIndexGate />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomeRedirect /> },
      {
        path: ":datasetId",
        element: <DatasetLayout />,
        errorElement: <RouteError />,
        children: [
          { index: true, element: <Navigate replace to="overview" /> },
          { path: "overview", element: <OverviewPage /> },
          { path: "stream", element: <StreamIndexPage /> },
          { path: "stream/:videoId", element: <StreamPage /> },
          { path: "compare", element: <ComparePage /> },
          { path: "table", element: <TablePage /> },
          { path: "about", element: <AboutPage /> },
          { path: "*", element: <Navigate replace to="overview" /> },
        ],
      },
      { path: "*", element: <HomeRedirect /> },
    ],
  },
]);
