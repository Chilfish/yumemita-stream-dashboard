import { lazy } from "react";

export const OverviewPage = lazy(() =>
  import("@/pages/overview-page").then(module => ({ default: module.OverviewPage })),
);
export const StreamIndexPage = lazy(() =>
  import("@/pages/stream-index-page").then(module => ({ default: module.StreamIndexPage })),
);
export const StreamPage = lazy(() =>
  import("@/pages/stream-page").then(module => ({ default: module.StreamPage })),
);
export const ComparePage = lazy(() =>
  import("@/pages/compare-page").then(module => ({ default: module.ComparePage })),
);
export const TablePage = lazy(() =>
  import("@/pages/table-page").then(module => ({ default: module.TablePage })),
);
export const AboutPage = lazy(() =>
  import("@/pages/about-page").then(module => ({ default: module.AboutPage })),
);
