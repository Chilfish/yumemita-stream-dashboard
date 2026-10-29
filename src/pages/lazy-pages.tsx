import { lazy } from "react";

export const HomePage = lazy(() =>
  import("@/pages/home-page").then(module => ({ default: module.HomePage })),
);
export const GroupHomePage = lazy(() =>
  import("@/pages/group-home-page").then(module => ({ default: module.GroupHomePage })),
);
export const GroupGalleryPage = lazy(() =>
  import("@/pages/group-gallery-page").then(module => ({ default: module.GroupGalleryPage })),
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
export const TrendsPage = lazy(() =>
  import("@/pages/trends-page").then(module => ({ default: module.TrendsPage })),
);
export const AboutPage = lazy(() =>
  import("@/pages/about-page").then(module => ({ default: module.AboutPage })),
);
export const GalleryPage = lazy(() =>
  import("@/pages/gallery-page").then(module => ({ default: module.GalleryPage })),
);
export const TranscriptsPage = lazy(() =>
  import("@/pages/transcripts-page").then(module => ({ default: module.TranscriptsPage })),
);
