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
  /** `MM-DD` = 那年今日；只取月和日，跨年份复用同一个筛选。 */
  day: string | null;
}

export const DEFAULT_GALLERY_PARAMS: GalleryParams = {
  order: DEFAULT_GALLERY_ORDER,
  member: null,
  type: DEFAULT_GALLERY_TYPE,
  day: null,
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

/**
 * `MM-DD` 的合法性按 2000 年（闰年）校验，`02-29` 可以通过；
 * `02-30` 这类不存在的日期回落到「全部」。
 */
export function isGalleryDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) {
    return false;
  }
  const month = Number(value.slice(0, 2));
  const day = Number(value.slice(3));
  const maxDay = new Date(Date.UTC(2000, month, 0)).getUTCDate();
  return day <= maxDay;
}

/** `YYYY-MM-DD` → `MM-DD`；不是完整日期时返回 `null`。 */
export function galleryDayOf(date: string | null | undefined): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const day = date.slice(5);
  return isGalleryDay(day) ? day : null;
}

/** 只取月和日，`?day=05-20` 显示为 `5 月 20 日`。 */
export function galleryDayLabel(day: string): string {
  if (!isGalleryDay(day)) return day;
  return `${Number(day.slice(0, 2))} 月 ${Number(day.slice(3))} 日`;
}

/**
 * 「那年今日」只收今天之前的场次：今天的场次已经出现在今日计划里，
 * 不在同一屏重复；同比日期早于今天时（如今天 11/9 查看 11/7）仍然包含。
 */
export function matchesGalleryDay(
  date: string | null | undefined,
  day: string | null,
  before?: string,
): boolean {
  if (!day) return true;
  if (!date || galleryDayOf(date) !== day) return false;
  return before ? date < before : true;
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

export function parseGalleryDay(value: string | null | undefined): string | null {
  return isGalleryDay(value) ? value : null;
}

export function parseGalleryParams(
  searchParams: URLSearchParams,
  memberIds: readonly string[] = [],
): GalleryParams {
  return {
    order: parseGalleryOrder(searchParams.get("order")),
    member: parseGalleryMember(searchParams.get("member"), memberIds),
    type: parseGalleryType(searchParams.get("type")),
    day: parseGalleryDay(searchParams.get("day")),
  };
}

export function isDefaultGalleryParams(params: GalleryParams): boolean {
  return (
    params.order === DEFAULT_GALLERY_ORDER &&
    params.member === null &&
    params.type === DEFAULT_GALLERY_TYPE &&
    params.day === null
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

  if (params.day && isGalleryDay(params.day)) {
    next.set("day", params.day);
  } else {
    next.delete("day");
  }

  return next;
}

/** 单独改排序时用：不碰 `member` / `type` / `day`，成员页也走这条路径。 */
export function writeGalleryOrder(
  base: URLSearchParams,
  order: GalleryOrder,
): URLSearchParams {
  const next = new URLSearchParams(base);
  if (order === DEFAULT_GALLERY_ORDER) next.delete("order");
  else next.set("order", order);
  return next;
}
