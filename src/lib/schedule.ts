import * as v from "valibot";
import { classifyTitle, CONTENT_TYPES, type ContentTypeKey } from "@/lib/classify";
import type { AdminScheduleItem, ScheduleSlot } from "@/types/calendar";

export const SCHEDULE_SLOTS = ["early", "mid", "late"] as const;

export const SLOT_LABELS: Record<ScheduleSlot, string> = {
  early: "早上",
  mid: "中午",
  late: "晚上",
};

/** 只有日期+时段时的名义开播时刻，仅用于排序与月网格定位。 */
export const SLOT_START_HOUR: Record<ScheduleSlot, number> = {
  early: 9,
  mid: 14,
  late: 20,
};

const JST = "Asia/Tokyo";
const dateKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: JST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const hourFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: JST,
  hour: "2-digit",
  hourCycle: "h23",
});

export function isScheduleSlot(value: unknown): value is ScheduleSlot {
  return typeof value === "string" && (SCHEDULE_SLOTS as readonly string[]).includes(value);
}

export function jstDateKeyFrom(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dateKeyFormat.format(date);
}

export function jstHour(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Number(hourFormat.format(date)) % 24;
}

/** 05:00–11:59 早，12:00–17:59 中，其余（18:00–次日 04:59）晚。 */
export function slotForJstTime(value: string | Date | null | undefined): ScheduleSlot | null {
  const hour = jstHour(value);
  if (hour == null) return null;
  if (hour >= 5 && hour < 12) return "early";
  if (hour >= 12 && hour < 18) return "mid";
  return "late";
}

export function nominalStart(date: string, slot: ScheduleSlot): string {
  return `${date}T${String(SLOT_START_HOUR[slot]).padStart(2, "0")}:00:00+09:00`;
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  );
}

export function hasTimeZone(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value);
}

export interface ResolvedScheduleTiming {
  date: string | null;
  slot: ScheduleSlot | null;
  scheduledAt: string | null;
  /** 展示与排序用的 ISO；只有日期+时段时是名义时间。 */
  at: string | null;
  timeTentative: boolean;
}

export function resolveScheduleTiming(input: {
  date?: string | null;
  slot?: ScheduleSlot | null;
  scheduledAt?: string | null;
}): ResolvedScheduleTiming {
  if (input.scheduledAt) {
    const date = jstDateKeyFrom(input.scheduledAt) ?? input.date ?? null;
    const slot = input.slot ?? slotForJstTime(input.scheduledAt);
    return {
      date,
      slot,
      scheduledAt: input.scheduledAt,
      at: input.scheduledAt,
      timeTentative: false,
    };
  }

  const date = input.date ?? null;
  const slot = input.slot ?? null;
  if (date && slot) {
    return {
      date,
      slot,
      scheduledAt: null,
      at: nominalStart(date, slot),
      timeTentative: true,
    };
  }

  return { date, slot, scheduledAt: null, at: null, timeTentative: false };
}

/** 管理端列表按日期分组，日期升序；日期待定的行归到最后。 */
export function groupSchedulesByDate(
  items: AdminScheduleItem[],
): Array<[string, AdminScheduleItem[]]> {
  const groups = new Map<string, AdminScheduleItem[]>();
  for (const item of items) {
    const key = item.date ?? "日期待定";
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** 从常见 YouTube 链接里取出 11 位 video id；不是视频链接时返回 null。 */
export function videoIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})(?:$|[&#/])/,
    /youtu\.be\/([A-Za-z0-9_-]{11})(?:$|[?&#/])/,
    /youtube(?:-nocookie)?\.com\/(?:live|shorts|embed)\/([A-Za-z0-9_-]{11})(?:$|[?&#/])/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1] ?? null;
  }
  return null;
}

export function manualEventKey(id: string): string {
  return `manual:${id}`;
}

export function youtubeEventKey(videoId: string): string {
  return `yt:${videoId}`;
}

const manualKeyPattern = /^manual:(\d{4}-\d{2}-\d{2})-(early|mid|late)(?:-(\d+))?$/;

export interface ManualEventKeyParts {
  date: string;
  slot: ScheduleSlot;
  /** 同日同时段的第几场，从 1 开始；第 1 场不带后缀。 */
  ordinal: number;
}

/** 解析 `manual:<date>-<slot>[-<ordinal>]`；不是自然键时返回 null。 */
export function parseManualEventKey(eventKey: string): ManualEventKeyParts | null {
  const match = manualKeyPattern.exec(eventKey);
  if (!match) return null;
  const [, date, slot, ordinalText] = match;
  if (!date || !isDateKey(date) || !isScheduleSlot(slot)) return null;
  if (!ordinalText) return { date, slot, ordinal: 1 };

  const ordinal = Number(ordinalText);
  if (!Number.isInteger(ordinal) || ordinal < 2 || String(ordinal) !== ordinalText) return null;
  return { date, slot, ordinal };
}

/**
 * 日期 + 时段已知时的自然键。同日同时段有多场时按序号顺延：
 * `manual:<date>-<slot>`、`manual:<date>-<slot>-2`、`-3`……
 */
export function scheduleEventKey(
  date: string,
  slot: ScheduleSlot,
  ordinal = 1,
): string {
  const base = `${date}-${slot}`;
  return manualEventKey(ordinal > 1 ? `${base}-${ordinal}` : base);
}

/**
 * 已知日期 + 时段时统一用自然键 `manual:<date>-<slot>`；
 * 只有时间未知时才退回 `yt:<videoId>`。链接不改变主键。
 */
export function scheduleNaturalKey(
  date: string | null | undefined,
  slot: ScheduleSlot | null | undefined,
  ordinal = 1,
): string | null {
  return date && slot ? scheduleEventKey(date, slot, ordinal) : null;
}

export function isManualEventKey(eventKey: string): boolean {
  return eventKey.startsWith("manual:");
}

export function isYoutubeEventKey(eventKey: string): boolean {
  return eventKey.startsWith("yt:");
}

export interface ScheduleOccurrence {
  scheduledAt: string | Date | null;
  title: string;
}

function occurrenceTime(value: string | Date | null): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/**
 * 同一成员同日同时段的两条记录是否指同一场直播。
 *
 * 两侧都有标题时只比标题：改期重提用的是同一个标题，仍是同一场；
 * 标题有一侧为空时退回比开播时间，两边都给了时间且不同就是两场。
 */
export function isSameScheduleOccurrence(a: ScheduleOccurrence, b: ScheduleOccurrence): boolean {
  const leftTitle = a.title.trim();
  const rightTitle = b.title.trim();
  if (leftTitle && rightTitle) return leftTitle === rightTitle;

  const leftAt = occurrenceTime(a.scheduledAt);
  const rightAt = occurrenceTime(b.scheduledAt);
  if (leftAt != null && rightAt != null) return leftAt === rightAt;
  return true;
}

/** 该成员该时段里第一个没被占用的序号。 */
export function freeScheduleEventKey(
  date: string,
  slot: ScheduleSlot,
  occupiedKeys: Iterable<string>,
): string {
  const used = new Set<number>();
  for (const eventKey of occupiedKeys) {
    const parts = parseManualEventKey(eventKey);
    if (parts && parts.date === date && parts.slot === slot) used.add(parts.ordinal);
  }

  let ordinal = 1;
  while (used.has(ordinal)) ordinal += 1;
  return scheduleEventKey(date, slot, ordinal);
}

export interface ScheduleOccurrenceRow extends ScheduleOccurrence {
  eventKey: string;
}

/** 跨午夜的 `late` 场归到前一晚：00:00–04:59 用前一天做锚点。 */
export function anchoredSlotDate(
  date: string | null | undefined,
  slot: ScheduleSlot | null | undefined,
  at: string | Date | null | undefined,
): string | null {
  if (!date || !slot) return null;
  const hour = jstHour(at ?? null);
  if (slot !== "late" || hour == null || hour >= 5) return date;

  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day - 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

/**
 * 写入时选择主键：同一场次已有自然键行就复用（幂等更新），
 * 否则在同日同时段顺延一个空序号，不会覆盖另一场。
 */
export function planScheduleEventKey(
  input: { date: string; slot: ScheduleSlot } & ScheduleOccurrence,
  existing: ScheduleOccurrenceRow[],
): string {
  for (const row of existing) {
    const parts = parseManualEventKey(row.eventKey);
    if (!parts || parts.date !== input.date || parts.slot !== input.slot) continue;
    if (isSameScheduleOccurrence(input, row)) return row.eventKey;
  }
  return freeScheduleEventKey(input.date, input.slot, existing.map(row => row.eventKey));
}

const isoWithZone = v.pipe(
  v.string(),
  v.check(value => hasTimeZone(value) && Number.isFinite(Date.parse(value)), "scheduledAt 必须是带时区的 ISO 8601"),
);

export const scheduleFieldsSchema = v.object({
  datasetId: v.pipe(v.string(), v.minLength(1, "datasetId 不能为空")),
  eventKey: v.optional(v.nullable(v.pipe(v.string(), v.minLength(1)))),
  id: v.optional(v.nullable(v.pipe(
    v.string(),
    v.regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "id 只能包含字母、数字、点、下划线和连字符"),
  ))),
  videoId: v.optional(v.nullable(v.pipe(
    v.string(),
    v.regex(/^[A-Za-z0-9_-]{11}$/, "videoId 必须是 11 位"),
  ))),
  title: v.optional(v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(200, "title 太长")))),
  date: v.optional(v.nullable(v.pipe(v.string(), v.check(value => isDateKey(value), "date 必须是 YYYY-MM-DD")))),
  slot: v.optional(v.nullable(v.picklist(SCHEDULE_SLOTS))),
  kind: v.optional(v.nullable(v.picklist(CONTENT_TYPES))),
  scheduledAt: v.optional(v.nullable(isoWithZone)),
  expectedMinutes: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(15), v.maxValue(720)))),
  availability: v.optional(v.nullable(v.picklist(["public", "subscriber_only"]))),
  cancelled: v.optional(v.boolean()),
  /** 管理端只允许写手工行；显式传 `manual` 时做一次校验。 */
  source: v.optional(v.literal("manual")),
  note: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(500)))),
  url: v.optional(v.nullable(v.pipe(v.string(), v.regex(/^https?:\/\//, "url 必须是 http(s) 地址")))),
  /** owner 之外的参与成员；去重后最多 4 个。 */
  participants: v.optional(v.nullable(v.pipe(
    v.array(v.string()),
    v.maxLength(4, "同场成员最多 4 个"),
  ))),
});

export type ScheduleWriteInput = v.InferOutput<typeof scheduleFieldsSchema>;

export function validateScheduleInput(input: unknown, mode: "create" | "patch"):
  { ok: true; value: ScheduleWriteInput } | { ok: false; error: string; field?: string } {
  const result = v.safeParse(scheduleFieldsSchema, input);
  if (!result.success) {
    const issue = result.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "请求体格式不正确",
      field: issue?.path?.map(part => String(part.key)).find(Boolean),
    };
  }

  const value = result.output;

  if (mode === "patch" && !value.eventKey) {
    return { ok: false, error: "PATCH 需要 eventKey", field: "eventKey" };
  }

  if (!value.scheduledAt && !value.date) {
    return { ok: false, error: "需要 date，或提供 scheduledAt", field: "date" };
  }

  if (value.date && !value.slot && !value.scheduledAt) {
    return { ok: false, error: "只给日期时还需要 slot（早上/中午/晚上）", field: "slot" };
  }

  const fromUrl = videoIdFromUrl(value.url);
  if (value.videoId && fromUrl && fromUrl !== value.videoId) {
    return { ok: false, error: "url 与 videoId 指向不同视频", field: "videoId" };
  }

  return { ok: true, value };
}

/**
 * 参与者规整：去掉 owner 自己、空值与重复项，保持提交顺序。
 * 成员是否存在由调用方查库校验，这里只做纯函数层面的清理。
 */
export function normalizeParticipants(
  participants: string[] | null | undefined,
  owner: string,
): string[] {
  const seen = new Set<string>([owner]);
  const result: string[] = [];
  for (const raw of participants ?? []) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/** 没指定类型时按标题推断；标题也为空就保持 null。 */
export function resolveKind(
  title: string | null | undefined,
  kind: ContentTypeKey | null | undefined,
): ContentTypeKey | null {
  if (kind) return kind;
  const text = title?.trim();
  return text ? classifyTitle(text).key : null;
}
