import type { APIContext, APIRoute } from "astro";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { getAdminScheduleList } from "@/db/queries/calendar";
import { datasets, scheduledStreams } from "@/db/schema";
import { deriveCalendarEventState, addDays, currentJstDay } from "@/lib/calendar";
import { isContentType } from "@/lib/classify";
import {
  isDateKey,
  isScheduleSlot,
  resolveEventKey,
  resolveKind,
  resolveScheduleTiming,
  validateScheduleInput,
} from "@/lib/schedule";
import type { AdminScheduleItem, CalendarEventState } from "@/types/calendar";

export const prerender = false;

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function fail(error: string, status: number, field?: string): Response {
  return json({ ok: false, error, ...(field ? { field } : {}) }, status);
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function readJson(context: APIContext): Promise<unknown | Response> {
  try {
    return await context.request.json();
  }
  catch {
    return fail("请求体必须是 JSON", 400);
  }
}

async function datasetExists(datasetId: string): Promise<boolean> {
  const rows = await db
    .select({ id: datasets.id })
    .from(datasets)
    .where(eq(datasets.id, datasetId))
    .limit(1);
  return rows.length > 0;
}

async function findRow(datasetId: string, eventKey: string) {
  const rows = await db
    .select()
    .from(scheduledStreams)
    .where(and(
      eq(scheduledStreams.datasetId, datasetId),
      eq(scheduledStreams.eventKey, eventKey),
    ))
    .limit(1);
  return rows[0] ?? null;
}

function rowToItem(row: typeof scheduledStreams.$inferSelect): AdminScheduleItem {
  const timing = resolveScheduleTiming({
    date: row.date,
    slot: isScheduleSlot(row.slot) ? row.slot : null,
    scheduledAt: iso(row.scheduledAt),
  });
  const cancelled = Boolean(row.cancelledAt);
  const state: CalendarEventState = deriveCalendarEventState(
    {
      cancelled,
      hasStream: false,
      at: timing.at,
      expectedMinutes: row.expectedMinutes,
      lastLiveAt: iso(row.lastLiveAt),
    },
    new Date(),
  );

  return {
    datasetId: row.datasetId,
    eventKey: row.eventKey,
    videoId: row.videoId,
    title: row.title,
    url: row.url,
    date: timing.date,
    slot: timing.slot,
    kind: resolveKind(row.title, isContentType(row.kind) ? row.kind : null),
    scheduledAt: iso(row.scheduledAt),
    timeTentative: timing.timeTentative,
    expectedMinutes: row.expectedMinutes,
    availability: row.availability,
    cancelled,
    note: row.note,
    source: row.source === "youtube" ? "youtube" : "manual",
    state,
    matchedStream: null,
    updatedAt: iso(row.updatedAt),
  };
}

/** 写入后重新读取一次，让响应里的 state / matchedStream 与 GET 一致。 */
async function fetchItem(
  datasetId: string,
  eventKey: string,
  date: string | null,
): Promise<AdminScheduleItem | null> {
  const day = date ?? currentJstDay(new Date());
  const items = await getAdminScheduleList(db, {
    from: day,
    to: day,
    datasetId,
    includeUndated: true,
  });
  return items.find(item => item.eventKey === eventKey) ?? null;
}

async function invalidate(context: APIContext, datasetId: string): Promise<boolean> {
  if (context.cache?.enabled !== true) return false;
  try {
    await context.cache.invalidate({
      tags: ["schedule", "group", `dataset-${datasetId}`],
    });
    return true;
  }
  catch (error) {
    console.error("[admin/schedule] purge failed", error);
    return false;
  }
}

export const GET: APIRoute = async (context) => {
  const today = currentJstDay(new Date());
  const fromParam = context.url.searchParams.get("from");
  const toParam = context.url.searchParams.get("to");
  const datasetId = context.url.searchParams.get("datasetId") ?? undefined;
  const includeCancelled = context.url.searchParams.get("includeCancelled") !== "false";
  const includeUndated = context.url.searchParams.get("includeUndated") === "true";

  const from = isDateKey(fromParam) ? fromParam : addDays(today, -7);
  const to = isDateKey(toParam) ? toParam : addDays(today, 60);
  if (from > to) return fail("from 不能晚于 to", 400, "from");

  let items = await getAdminScheduleList(db, { from, to, datasetId, includeUndated });
  if (!includeCancelled) items = items.filter(item => !item.cancelled);

  return json({ ok: true, range: { from, to }, items });
};

export const POST: APIRoute = async (context) => {
  const raw = await readJson(context);
  if (raw instanceof Response) return raw;

  const parsed = validateScheduleInput(raw, "create");
  if (!parsed.ok) return fail(parsed.error, 400, parsed.field);
  const input = parsed.value;

  if (!(await datasetExists(input.datasetId))) {
    return fail("datasetId 不存在", 404, "datasetId");
  }

  const timing = resolveScheduleTiming(input);
  const naturalKey = timing.date && timing.slot ? `${timing.date}-${timing.slot}` : null;
  const eventKey = resolveEventKey(input, naturalKey);
  if (!eventKey) return fail("无法确定 eventKey", 400, "eventKey");

  const now = new Date();
  const values = {
    datasetId: input.datasetId,
    eventKey,
    videoId: input.videoId ?? null,
    title: input.title ?? "",
    url: input.url ?? null,
    date: timing.date,
    slot: timing.slot,
    kind: resolveKind(input.title, input.kind),
    scheduledAt: timing.scheduledAt ? new Date(timing.scheduledAt) : null,
    expectedMinutes: input.expectedMinutes ?? null,
    cancelledAt: input.cancelled ? now : null,
    availability: input.availability ?? "public",
    source: "manual",
    note: input.note ?? null,
    updatedAt: now,
  };

  const existingBefore = await findRow(input.datasetId, eventKey);
  const [row] = await db
    .insert(scheduledStreams)
    .values(values)
    .onConflictDoUpdate({
      target: [scheduledStreams.datasetId, scheduledStreams.eventKey],
      set: {
        videoId: sql`excluded.video_id`,
        title: sql`excluded.title`,
        url: sql`excluded.url`,
        date: sql`excluded.date`,
        slot: sql`excluded.slot`,
        scheduledAt: sql`excluded.scheduled_at`,
        expectedMinutes: sql`excluded.expected_minutes`,
        cancelledAt: sql`excluded.cancelled_at`,
        availability: sql`excluded.availability`,
        note: sql`excluded.note`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .returning();

  const invalidated = await invalidate(context, input.datasetId);
  const item = await fetchItem(input.datasetId, eventKey, timing.date);
  return json(
    { ok: true, item: item ?? (row ? rowToItem(row) : null), invalidated },
    existingBefore ? 200 : 201,
  );
};

function pick<T>(body: Record<string, unknown>, key: string, fallback: T): T {
  return Object.hasOwn(body, key) ? (body[key] as T) : fallback;
}

export const PATCH: APIRoute = async (context) => {
  const raw = await readJson(context);
  if (raw instanceof Response) return raw;
  if (!raw || typeof raw !== "object") return fail("请求体必须是 JSON 对象", 400);

  const body = raw as Record<string, unknown>;
  const datasetId = typeof body.datasetId === "string" ? body.datasetId : "";
  const eventKey = typeof body.eventKey === "string" ? body.eventKey : "";
  if (!datasetId || !eventKey) return fail("需要 datasetId 与 eventKey", 400, !datasetId ? "datasetId" : "eventKey");

  const existing = await findRow(datasetId, eventKey);
  if (!existing) return fail("日程不存在", 404);

  // 只改精确时间时让时段重新派生，避免沿用旧时段。
  const clearsSlot = Object.hasOwn(body, "scheduledAt") && !Object.hasOwn(body, "slot");
  const merged = {
    datasetId,
    eventKey,
    title: pick(body, "title", existing.title),
    date: pick(body, "date", existing.date),
    slot: clearsSlot
      ? null
      : pick(body, "slot", isScheduleSlot(existing.slot) ? existing.slot : null),
    kind: pick(body, "kind", isContentType(existing.kind) ? existing.kind : null),
    scheduledAt: pick(body, "scheduledAt", iso(existing.scheduledAt)),
    id: pick(body, "id", null),
    videoId: pick(body, "videoId", existing.videoId),
    expectedMinutes: pick(body, "expectedMinutes", existing.expectedMinutes),
    availability: pick(body, "availability", existing.availability),
    cancelled: pick(body, "cancelled", Boolean(existing.cancelledAt)),
    note: pick(body, "note", existing.note),
    url: pick(body, "url", existing.url),
  };

  const parsed = validateScheduleInput(merged, "create");
  if (!parsed.ok) return fail(parsed.error, 400, parsed.field);
  const input = parsed.value;

  const timing = resolveScheduleTiming(input);
  const nextKey = input.videoId ? `yt:${input.videoId}` : eventKey;
  const now = new Date();

  if (nextKey !== eventKey) {
    const target = await findRow(datasetId, nextKey);
    if (target) {
      // 合并到已有自动行时保留这次编辑的字段，不能只删掉手工行。
      const [updated] = await db
        .update(scheduledStreams)
        .set({
          title: input.title?.trim() ? input.title : target.title,
          url: input.url ?? target.url,
          date: timing.date ?? target.date,
          slot: timing.slot ?? target.slot,
          kind: resolveKind(input.title, input.kind) ?? target.kind,
          scheduledAt: timing.scheduledAt ? new Date(timing.scheduledAt) : target.scheduledAt,
          expectedMinutes: input.expectedMinutes ?? target.expectedMinutes,
          availability: input.availability ?? target.availability,
          cancelledAt: input.cancelled ? (target.cancelledAt ?? now) : target.cancelledAt,
          note: input.note ?? target.note,
          updatedAt: now,
        })
        .where(and(
          eq(scheduledStreams.datasetId, datasetId),
          eq(scheduledStreams.eventKey, nextKey),
        ))
        .returning()

      await db.delete(scheduledStreams).where(and(
        eq(scheduledStreams.datasetId, datasetId),
        eq(scheduledStreams.eventKey, eventKey),
      ));
      const invalidated = await invalidate(context, datasetId);
      return json({ ok: true, item: rowToItem(updated ?? target), merged: true, invalidated });
    }

    await db.delete(scheduledStreams).where(and(
      eq(scheduledStreams.datasetId, datasetId),
      eq(scheduledStreams.eventKey, eventKey),
    ));
  }

  const [row] = await db
    .insert(scheduledStreams)
    .values({
      datasetId,
      eventKey: nextKey,
      videoId: input.videoId ?? null,
      title: input.title ?? "",
      url: input.url ?? null,
      date: timing.date,
      slot: timing.slot,
      kind: resolveKind(input.title, input.kind),
      scheduledAt: timing.scheduledAt ? new Date(timing.scheduledAt) : null,
      expectedMinutes: input.expectedMinutes ?? null,
      cancelledAt: input.cancelled ? (existing.cancelledAt ?? now) : null,
      availability: input.availability ?? existing.availability ?? "public",
      source: existing.source,
      note: input.note ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [scheduledStreams.datasetId, scheduledStreams.eventKey],
      set: {
        videoId: sql`excluded.video_id`,
        title: sql`excluded.title`,
        url: sql`excluded.url`,
        date: sql`excluded.date`,
        slot: sql`excluded.slot`,
        scheduledAt: sql`excluded.scheduled_at`,
        expectedMinutes: sql`excluded.expected_minutes`,
        cancelledAt: sql`excluded.cancelled_at`,
        availability: sql`excluded.availability`,
        note: sql`excluded.note`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .returning();

  const invalidated = await invalidate(context, datasetId);
  const item = await fetchItem(datasetId, nextKey, timing.date);
  return json({ ok: true, item: item ?? (row ? rowToItem(row) : null), invalidated });
};

export const DELETE: APIRoute = async (context) => {
  const datasetId = context.url.searchParams.get("datasetId") ?? "";
  const eventKey = context.url.searchParams.get("eventKey") ?? "";
  if (!datasetId || !eventKey) {
    return fail("需要 datasetId 与 eventKey", 400, !datasetId ? "datasetId" : "eventKey");
  }
  const existing = await findRow(datasetId, eventKey);
  if (!existing) return fail("日程不存在", 404);
  if (existing.source !== "manual") return fail("自动同步的日程不能删除", 409);

  await db.delete(scheduledStreams).where(and(
    eq(scheduledStreams.datasetId, datasetId),
    eq(scheduledStreams.eventKey, eventKey),
  ));

  const invalidated = await invalidate(context, datasetId);
  return json({ ok: true, deleted: 1, invalidated });
};
