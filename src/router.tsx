import { createHashRouter } from "react-router";
import { DatasetIndexGate } from "@/components/dashboard/dataset-index-gate";
import { DatasetLayout } from "@/components/dashboard/dataset-layout";
import { GroupLayout } from "@/components/dashboard/group-layout";
import { RouteError } from "@/components/dashboard/route-error";
import { HomeRedirect } from "@/pages/home-redirect";
import {
  LegacyOverviewRedirect,
  LegacyTableRedirect,
} from "@/pages/legacy-redirects";
import {
  AboutPage,
  ComparePage,
  GalleryPage,
  GroupGalleryPage,
  GroupHomePage,
  HomePage,
  StreamIndexPage,
  StreamPage,
  StreamsPage,
  TranscriptsPage,
  TrendsPage,
} from "@/pages/lazy-pages";

export const router = createHashRouter([
  {
    path: "/",
    element: <DatasetIndexGate />,
    errorElement: <RouteError />,
    children: [
      {
        element: <GroupLayout />,
        errorElement: <RouteError />,
        children: [
          { index: true, element: <GroupHomePage /> },
          { path: "gallery", element: <GroupGalleryPage /> },
          { path: "*", element: <GroupHomePage /> },
        ],
      },
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
          { path: "gallery", element: <GalleryPage /> },
          { path: "transcripts", element: <TranscriptsPage /> },
          { path: "compare", element: <ComparePage /> },
          { path: "about", element: <AboutPage /> },
          { path: "overview", element: <LegacyOverviewRedirect /> },
          { path: "table", element: <LegacyTableRedirect /> },
          { path: "*", element: <HomeRedirect /> },
        ],
      },
    ],
  },
]);
