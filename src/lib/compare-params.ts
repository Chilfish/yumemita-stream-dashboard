import { isContentType } from "@/lib/classify";
import type { CompareParams, CompareWindow } from "@/types/compare";

export const COMPARE_WINDOWS = [3, 6, 12, "all"] as const;
export const DEFAULT_COMPARE_WINDOW: CompareWindow = 6;
/** 低于这个场次数的格子标「样本不足」，图表点仍保留。 */
export const MIN_COMPARE_SAMPLE = 3;

export function isCompareWindow(value: unknown): value is CompareWindow {
  return (
    value === 3 ||
    value === 6 ||
    value === 12 ||
    value === "all"
  );
}

/** URL 里的窗口是字符串；归一化后再判断，避免 `"3"` 落回默认值。 */
function parseWindow(value: string | null): CompareWindow {
  if (value === "all") return "all";
  const months = value ? Number(value) : Number.NaN;
  return isCompareWindow(months) ? months : DEFAULT_COMPARE_WINDOW;
}

export function parseCompareParams(
  search: URLSearchParams,
  datasets: { id: string }[],
): CompareParams {
  const ids = datasets.map(dataset => dataset.id);
  const valid = new Set(ids);

  const picked: string[] = [];
  for (const part of (search.get("members") ?? "").split(",")) {
    const id = part.trim();
    if (!id || !valid.has(id) || picked.includes(id)) continue;
    picked.push(id);
  }

  const typeParam = search.get("type");
  const monthsParam = search.get("months");

  return {
    members: picked.length > 0 ? picked : ids,
    type: isContentType(typeParam) ? typeParam : null,
    months: parseWindow(monthsParam),
  };
}

/** 默认值（全部成员 / 全部类型 / 6 个月）不写进 URL。 */
export function compareSearch(params: CompareParams, allMemberIds: string[]): string {
  const search = new URLSearchParams();
  const members = params.members.filter(id => allMemberIds.includes(id));

  if (members.length > 0 && members.length < allMemberIds.length) {
    search.set("members", members.join(","));
  }
  if (params.type) search.set("type", params.type);
  if (params.months !== DEFAULT_COMPARE_WINDOW) search.set("months", String(params.months));

  return search.toString();
}
