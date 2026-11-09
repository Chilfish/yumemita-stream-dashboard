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

/**
 * 已知日期 + 时段时统一用自然键 `manual:<date>-<slot>`；
 * 只有时间未知时才退回 `yt:<videoId>`。链接不改变主键。
 */
export function scheduleNaturalKey(
  date: string | null | undefined,
  slot: ScheduleSlot | null | undefined,
): string | null {
  return date && slot ? manualEventKey(`${date}-${slot}`) : null;
}

export function isManualEventKey(eventKey: string): boolean {
  return eventKey.startsWith("manual:");
}

/** `manual:<YYYY-MM-DD>-<slot>`：由日期 + 时段自然键生成的主键。 */
export function isNaturalEventKey(eventKey: string): boolean {
  return /^manual:\d{4}-\d{2}-\d{2}-(early|mid|late)$/.test(eventKey);
}

export function isYoutubeEventKey(eventKey: string): boolean {
  return eventKey.startsWith("yt:");
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

/** 没指定类型时按标题推断；标题也为空就保持 null。 */
export function resolveKind(
  title: string | null | undefined,
  kind: ContentTypeKey | null | undefined,
): ContentTypeKey | null {
  if (kind) return kind;
  const text = title?.trim();
  return text ? classifyTitle(text).key : null;
}

/**
 * 主键优先级：显式 `eventKey` / `id` > 日期 + 时段自然键 > `videoId`。
 * 链接只作为外链与匹配线索，不改变主键；已有 `yt:` 行会在同步时归一到自然键。
 */
export function resolveEventKey(
  input: Pick<ScheduleWriteInput, "eventKey" | "id" | "videoId">,
  naturalKey?: string | null,
): string | null {
  if (input.eventKey) return input.eventKey;
  if (input.id) return manualEventKey(input.id);
  if (naturalKey) return manualEventKey(naturalKey);
  if (input.videoId) return youtubeEventKey(input.videoId);
  return null;
}
