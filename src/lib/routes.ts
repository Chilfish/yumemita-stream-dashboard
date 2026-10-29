export const VIEWS = [
  "home",
  "streams",
  "stream",
  "compare",
  "about",
  "trends",
  "gallery",
  "transcripts",
] as const;

export type ViewKey = (typeof VIEWS)[number];

export const STREAM_SUBVIEWS = [
  "overview",
  "timeline",
  "words",
  "paid",
  "comments",
  "transcript",
] as const;

export type StreamSubView = (typeof STREAM_SUBVIEWS)[number];

export const DEFAULT_STREAM_SUBVIEW: StreamSubView = "overview";

/** 组级（跨成员）页面：没有 `:datasetId` 前缀，直接挂在根路由下。 */
export const GROUP_VIEWS = ["home", "gallery"] as const;

export type GroupViewKey = (typeof GROUP_VIEWS)[number];

export const MAX_COMPARE = 4;

export function isViewKey(value: unknown): value is ViewKey {
  return typeof value === "string" && (VIEWS as readonly string[]).includes(value);
}

export function isStreamSubView(value: unknown): value is StreamSubView {
  return typeof value === "string" && (STREAM_SUBVIEWS as readonly string[]).includes(value);
}

export function datasetPath(datasetId: string): string {
  return `/${encodeURIComponent(datasetId)}`;
}

export function groupHomePath(): string {
  return "/";
}

export function groupGalleryPath(): string {
  return "/gallery";
}

export function groupSectionFromPathname(pathname: string): GroupViewKey {
  return pathname === groupGalleryPath() ? "gallery" : "home";
}

export function homePath(datasetId: string): string {
  return datasetPath(datasetId);
}

export function streamsPath(datasetId: string): string {
  return `${datasetPath(datasetId)}/streams`;
}

export function streamPath(
  datasetId: string,
  videoId: string,
  view: StreamSubView = DEFAULT_STREAM_SUBVIEW,
): string {
  const base = `${datasetPath(datasetId)}/stream/${encodeURIComponent(videoId)}`;
  return view === DEFAULT_STREAM_SUBVIEW ? base : `${base}?view=${view}`;
}

export function trendsPath(datasetId: string): string {
  return `${datasetPath(datasetId)}/trends`;
}

export function galleryPath(datasetId: string): string {
  return `${datasetPath(datasetId)}/gallery`;
}

export function transcriptsPath(datasetId: string): string {
  return `${datasetPath(datasetId)}/transcripts`;
}

export function comparePath(datasetId: string): string {
  return `${datasetPath(datasetId)}/compare`;
}

export function aboutPath(datasetId: string): string {
  return `${datasetPath(datasetId)}/about`;
}

export function viewPath(datasetId: string, view: ViewKey): string {
  switch (view) {
    case "home":
      return homePath(datasetId);
    case "streams":
      return streamsPath(datasetId);
    case "stream":
      return `${datasetPath(datasetId)}/stream`;
    case "trends":
      return trendsPath(datasetId);
    case "gallery":
      return galleryPath(datasetId);
    case "transcripts":
      return transcriptsPath(datasetId);
    case "compare":
      return comparePath(datasetId);
    case "about":
      return aboutPath(datasetId);
  }
}

export function sectionFromPathname(pathname: string): ViewKey {
  const segment = pathname.split("/")[2];
  if (!segment) return "home";
  if (segment === "streams" || segment === "table") return "streams";
  if (segment === "stream") return "stream";
  if (segment === "trends") return "trends";
  if (segment === "gallery") return "gallery";
  if (segment === "transcripts") return "transcripts";
  if (segment === "compare") return "compare";
  if (segment === "about") return "about";
  return "home";
}

export function parseStreamSubView(param: string | null): StreamSubView {
  return isStreamSubView(param) ? param : DEFAULT_STREAM_SUBVIEW;
}

export function parseCompareIds(param: string | null, max = MAX_COMPARE): string[] {
  if (!param) return [];
  const ids: string[] = [];
  for (const part of param.split(",")) {
    const id = part.trim();
    if (!id || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= max) break;
  }
  return ids;
}

export function toggleCompareId(ids: string[], id: string, max = MAX_COMPARE): string[] {
  if (ids.includes(id)) return ids.filter(current => current !== id);
  if (ids.length >= max) return ids;
  return [...ids, id];
}
