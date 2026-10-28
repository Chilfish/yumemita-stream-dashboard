export const VIEWS = ["overview", "stream", "compare", "table", "about"] as const;

export type ViewKey = (typeof VIEWS)[number];

export const MAX_COMPARE = 4;

export function isViewKey(value: unknown): value is ViewKey {
  return typeof value === "string" && (VIEWS as readonly string[]).includes(value);
}

export function datasetPath(datasetId: string): string {
  return `/${encodeURIComponent(datasetId)}`;
}

export function viewPath(datasetId: string, view: ViewKey): string {
  return `${datasetPath(datasetId)}/${view}`;
}

export function streamPath(datasetId: string, videoId: string): string {
  return `${datasetPath(datasetId)}/stream/${encodeURIComponent(videoId)}`;
}

export function sectionFromPathname(pathname: string): ViewKey {
  const segment = pathname.split("/")[2];
  return isViewKey(segment) ? segment : "overview";
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
