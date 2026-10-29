import { createHashRouter } from "react-router";
import { DatasetIndexGate } from "@/components/dashboard/dataset-index-gate";
import { DatasetLayout } from "@/components/dashboard/dataset-layout";
import { RouteError } from "@/components/dashboard/route-error";
import { HomeRedirect } from "@/pages/home-redirect";
import {
  LegacyOverviewRedirect,
  LegacyTableRedirect,
} from "@/pages/legacy-redirects";
import {
  AboutPage,
  ComparePage,
  HomePage,
  StreamIndexPage,
  StreamPage,
  StreamsPage,
  TrendsPage,
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
          { index: true, element: <HomePage /> },
          { path: "streams", element: <StreamsPage /> },
          { path: "stream", element: <StreamIndexPage /> },
          { path: "stream/:videoId", element: <StreamPage /> },
          { path: "trends", element: <TrendsPage /> },
          { path: "compare", element: <ComparePage /> },
          { path: "about", element: <AboutPage /> },
          { path: "overview", element: <LegacyOverviewRedirect /> },
          { path: "table", element: <LegacyTableRedirect /> },
          { path: "*", element: <HomeRedirect /> },
        ],
      },
      { path: "*", element: <HomeRedirect /> },
    ],
  },
]);
