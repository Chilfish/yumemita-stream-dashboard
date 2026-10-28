import { lazy } from "react";

export const HomePage = lazy(() =>
  import("@/pages/home-page").then(module => ({ default: module.HomePage })),
);
export const StreamsPage = lazy(() =>
  import("@/pages/streams-page").then(module => ({ default: module.StreamsPage })),
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
export const AboutPage = lazy(() =>
  import("@/pages/about-page").then(module => ({ default: module.AboutPage })),
);
