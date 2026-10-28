export const VIEWS = ["home", "streams", "stream", "compare", "about"] as const;

export type ViewKey = (typeof VIEWS)[number];

export const STREAM_SUBVIEWS = ["overview", "timeline", "words", "paid", "comments"] as const;

export type StreamSubView = (typeof STREAM_SUBVIEWS)[number];

export const DEFAULT_STREAM_SUBVIEW: StreamSubView = "overview";

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
