import {
  TRANSCRIPT_SORT_ORDERS,
  isTranscriptSortOrder,
  type TranscriptSortOrder,
} from "@/lib/transcripts";

export interface TranscriptParams {
  q: string;
  tags: string[];
  sort: TranscriptSortOrder;
  dense: boolean;
}

export const DEFAULT_TRANSCRIPT_PARAMS: TranscriptParams = {
  q: "",
  tags: [],
  sort: "newest",
  dense: false,
};

function normalizeTags(tags: Iterable<string>): string[] {
  return [...new Set([...tags].map(tag => tag.trim()).filter(Boolean))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
}

export function parseTranscriptParams(searchParams: URLSearchParams): TranscriptParams {
  const tags = searchParams.get("tags");
  const sort = searchParams.get("sort");

  return {
    q: searchParams.get("q")?.trim() ?? "",
    tags: tags ? normalizeTags(tags.split(",")) : [],
    sort: isTranscriptSortOrder(sort) ? sort : DEFAULT_TRANSCRIPT_PARAMS.sort,
    dense: searchParams.get("dense") === "1",
  };
}

export function writeTranscriptParams(
  base: URLSearchParams,
  params: TranscriptParams,
): URLSearchParams {
  const next = new URLSearchParams(base);

  if (params.q.trim()) next.set("q", params.q);
  else next.delete("q");

  const tags = normalizeTags(params.tags);
  if (tags.length > 0) next.set("tags", tags.join(","));
  else next.delete("tags");

  if (params.sort === DEFAULT_TRANSCRIPT_PARAMS.sort) next.delete("sort");
  else next.set("sort", params.sort);

  if (params.dense) next.set("dense", "1");
  else next.delete("dense");

  return next;
}

/** 筛选面板上的数字：标签数 + 非默认排序 + 紧凑密度。 */
export function transcriptFilterCount(params: TranscriptParams): number {
  return (
    params.tags.length +
    Number(params.sort !== DEFAULT_TRANSCRIPT_PARAMS.sort) +
    Number(params.dense)
  );
}

export function hasTranscriptFilters(params: TranscriptParams): boolean {
  return params.q.trim().length > 0 || params.tags.length > 0;
}

export { TRANSCRIPT_SORT_ORDERS };
