import { CONTENT_TYPES } from "@/lib/classify";

/** 相册排序：默认最新在前，只有 `?order=asc` 才写进 URL。 */
export const GALLERY_ORDERS = ["desc", "asc"] as const;

export type GalleryOrder = (typeof GALLERY_ORDERS)[number];

export const DEFAULT_GALLERY_ORDER: GalleryOrder = "desc";

/** 内容类型筛选：`all` 表示不筛，其余与 `classify.ts` 的类型键一一对应。 */
export const GALLERY_TYPE_FILTERS = ["all", ...CONTENT_TYPES] as const;

export type GalleryTypeFilter = (typeof GALLERY_TYPE_FILTERS)[number];

export const DEFAULT_GALLERY_TYPE: GalleryTypeFilter = "all";

/** 成员筛选的「全部」只存在于界面（chip 的 value），不会写进 URL。 */
export const GALLERY_ALL_MEMBERS = "all";

export interface GalleryParams {
  order: GalleryOrder;
  /** `null` = 全部成员；其余必须是 dataset index 里存在的 id。 */
  member: string | null;
  type: GalleryTypeFilter;
}

export const DEFAULT_GALLERY_PARAMS: GalleryParams = {
  order: DEFAULT_GALLERY_ORDER,
  member: null,
  type: DEFAULT_GALLERY_TYPE,
};

export function isGalleryOrder(value: unknown): value is GalleryOrder {
  return typeof value === "string" && (GALLERY_ORDERS as readonly string[]).includes(value);
}

export function isGalleryTypeFilter(value: unknown): value is GalleryTypeFilter {
  return typeof value === "string" && (GALLERY_TYPE_FILTERS as readonly string[]).includes(value);
}

/** 成员 id 必须能在 dataset index 里查到，避免手改 URL 造出空相册。 */
export function isGalleryMemberId(
  value: unknown,
  memberIds: readonly string[],
): value is string {
  return typeof value === "string" && value.length > 0 && memberIds.includes(value);
}

/** 单个参数解析：非法值一律回落到默认值，不抛错。 */
export function parseGalleryOrder(value: string | null | undefined): GalleryOrder {
  return isGalleryOrder(value) ? value : DEFAULT_GALLERY_ORDER;
}

export function parseGalleryType(value: string | null | undefined): GalleryTypeFilter {
  return isGalleryTypeFilter(value) ? value : DEFAULT_GALLERY_TYPE;
}

export function parseGalleryMember(
  value: string | null | undefined,
  memberIds: readonly string[],
): string | null {
  return isGalleryMemberId(value, memberIds) ? value : null;
}

export function parseGalleryParams(
  searchParams: URLSearchParams,
  memberIds: readonly string[] = [],
): GalleryParams {
  return {
    order: parseGalleryOrder(searchParams.get("order")),
    member: parseGalleryMember(searchParams.get("member"), memberIds),
    type: parseGalleryType(searchParams.get("type")),
  };
}

export function isDefaultGalleryParams(params: GalleryParams): boolean {
  return (
    params.order === DEFAULT_GALLERY_ORDER &&
    params.member === null &&
    params.type === DEFAULT_GALLERY_TYPE
  );
}

/**
 * 只写非默认值，其余 param 原样保留：
 * 排序与筛选互相独立，改一个不会把另一个从 URL 里挤掉。
 */
export function writeGalleryParams(
  base: URLSearchParams,
  params: GalleryParams,
): URLSearchParams {
  const next = new URLSearchParams(base);

  if (params.order === DEFAULT_GALLERY_ORDER) {
    next.delete("order");
  } else {
    next.set("order", params.order);
  }

  if (params.member && params.member.length > 0) {
    next.set("member", params.member);
  } else {
    next.delete("member");
  }

  if (params.type === DEFAULT_GALLERY_TYPE) {
    next.delete("type");
  } else {
    next.set("type", params.type);
  }

  return next;
}

/** 单独改排序时用：不碰 `member` / `type`，成员页也走这条路径。 */
export function writeGalleryOrder(
  base: URLSearchParams,
  order: GalleryOrder,
): URLSearchParams {
  const next = new URLSearchParams(base);
  if (order === DEFAULT_GALLERY_ORDER) next.delete("order");
  else next.set("order", order);
  return next;
}
