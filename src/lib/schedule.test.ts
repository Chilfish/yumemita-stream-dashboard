import { describe, expect, it } from "vitest";
import {
  groupSchedulesByDate,
  hasTimeZone,
  isDateKey,
  jstDateKeyFrom,
  nominalStart,
  resolveEventKey,
  resolveScheduleTiming,
  slotForJstTime,
  validateScheduleInput,
  videoIdFromUrl,
} from "./schedule";
import type { AdminScheduleItem } from "@/types/calendar";

function scheduleItem(overrides: Partial<AdminScheduleItem> = {}): AdminScheduleItem {
  return {
    datasetId: "nonoka",
    eventKey: "manual:test",
    videoId: null,
    title: "雑談",
    url: null,
    date: "2026-11-08",
    slot: "late",
    kind: null,
    scheduledAt: null,
    timeTentative: true,
    expectedMinutes: null,
    availability: "public",
    cancelled: false,
    note: null,
    source: "manual",
    state: "upcoming",
    matchedStream: null,
    updatedAt: null,
    ...overrides,
  };
}

describe("时段", () => {
  it("按 JST 划分早 / 中 / 晚", () => {
    expect(slotForJstTime("2026-11-08T05:00:00+09:00")).toBe("early");
    expect(slotForJstTime("2026-11-08T11:59:00+09:00")).toBe("early");
    expect(slotForJstTime("2026-11-08T12:00:00+09:00")).toBe("mid");
    expect(slotForJstTime("2026-11-08T17:59:00+09:00")).toBe("mid");
    expect(slotForJstTime("2026-11-08T18:00:00+09:00")).toBe("late");
    expect(slotForJstTime("2026-11-09T04:59:00+09:00")).toBe("late");
  });

  it("UTC 时间先换算成 JST 再取时段", () => {
    expect(jstDateKeyFrom("2026-11-08T15:30:00Z")).toBe("2026-11-09");
    expect(slotForJstTime("2026-11-08T15:30:00Z")).toBe("late");
  });
});

describe("时间解析", () => {
  it("只有日期+时段时用名义时间并标记 tentative", () => {
    expect(resolveScheduleTiming({ date: "2026-11-08", slot: "late" })).toEqual({
      date: "2026-11-08",
      slot: "late",
      scheduledAt: null,
      at: nominalStart("2026-11-08", "late"),
      timeTentative: true,
    });
  });

  it("精确时间优先，并派生日期与时段", () => {
    expect(
      resolveScheduleTiming({ scheduledAt: "2026-11-09T00:30:00+09:00" }),
    ).toEqual({
      date: "2026-11-09",
      slot: "late",
      scheduledAt: "2026-11-09T00:30:00+09:00",
      at: "2026-11-09T00:30:00+09:00",
      timeTentative: false,
    });
  });

  it("日期与时区校验", () => {
    expect(isDateKey("2026-02-28")).toBe(true);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(hasTimeZone("2026-11-08T20:00:00+09:00")).toBe(true);
    expect(hasTimeZone("2026-11-08T20:00:00")).toBe(false);
  });
});

describe("管理端列表分组", () => {
  it("按日期升序分组，同一天保持原顺序", () => {
    const grouped = groupSchedulesByDate([
      scheduleItem({ eventKey: "a", date: "2026-11-09" }),
      scheduleItem({ eventKey: "b", date: "2026-11-08" }),
      scheduleItem({ eventKey: "c", date: "2026-11-08" }),
    ]);

    expect(grouped.map(([date]) => date)).toEqual(["2026-11-08", "2026-11-09"]);
    expect(grouped[0]?.[1].map(item => item.eventKey)).toEqual(["b", "c"]);
  });

  it("日期待定的行归到最后", () => {
    const grouped = groupSchedulesByDate([
      scheduleItem({ eventKey: "a", date: null }),
      scheduleItem({ eventKey: "b", date: "2026-11-08" }),
    ]);

    expect(grouped.map(([date]) => date)).toEqual(["2026-11-08", "日期待定"]);
  });
});

describe("链接解析", () => {
  it("从常见 YouTube 链接里取 video id", () => {
    expect(videoIdFromUrl("https://www.youtube.com/watch?v=L_WHcvB4dfQ")).toBe("L_WHcvB4dfQ");
    expect(videoIdFromUrl("https://youtu.be/L_WHcvB4dfQ?t=30")).toBe("L_WHcvB4dfQ");
    expect(videoIdFromUrl("https://www.youtube.com/live/L_WHcvB4dfQ")).toBe("L_WHcvB4dfQ");
    expect(videoIdFromUrl("https://www.youtube.com/shorts/L_WHcvB4dfQ")).toBe("L_WHcvB4dfQ");
    expect(videoIdFromUrl("https://www.youtube.com/watch?v=L_WHcvB4dfQ&list=PL1")).toBe("L_WHcvB4dfQ");
    expect(videoIdFromUrl("https://example.com/watch?v=short")).toBeNull();
    expect(videoIdFromUrl(null)).toBeNull();
  });
});

describe("输入校验", () => {
  it("带链接的手工行仍用日期 + 时段自然键", () => {
    const result = validateScheduleInput(
      {
        datasetId: "miyako",
        date: "2026-11-11",
        slot: "late",
        url: "https://www.youtube.com/watch?v=L_WHcvB4dfQ",
      },
      "create",
    );

    expect(result.ok && result.value.videoId).toBeUndefined();
    expect(
      resolveEventKey(result.ok ? result.value : {}, "2026-11-11-late"),
    ).toBe("manual:2026-11-11-late");
  });

  it("没有日期时段时才退回 yt 主键", () => {
    expect(
      resolveEventKey({ videoId: "L_WHcvB4dfQ" }, null),
    ).toBe("yt:L_WHcvB4dfQ");
  });

  it("url 与显式 videoId 冲突时拒绝", () => {
    const result = validateScheduleInput(
      {
        datasetId: "miyako",
        date: "2026-11-11",
        slot: "late",
        videoId: "aaaaaaaaaaa",
        url: "https://www.youtube.com/watch?v=L_WHcvB4dfQ",
      },
      "create",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("videoId");
  });

  it("接受只给日期+时段", () => {
    const result = validateScheduleInput(
      { datasetId: "nonoka", title: "雑談", date: "2026-11-08", slot: "late" },
      "create",
    );
    expect(result.ok).toBe(true);
  });

  it("标题可以缺失或为空", () => {
    expect(
      validateScheduleInput({ datasetId: "nonoka", date: "2026-11-08", slot: "late" }, "create").ok,
    ).toBe(true);
    expect(
      validateScheduleInput({ datasetId: "nonoka", title: "", date: "2026-11-08", slot: "late" }, "create").ok,
    ).toBe(true);
  });

  it("日期缺时段、非法 slot、非法 videoId 都拒绝", () => {
    expect(
      validateScheduleInput({ datasetId: "nonoka", title: "x", date: "2026-11-08" }, "create").ok,
    ).toBe(false);
    expect(
      validateScheduleInput(
        { datasetId: "nonoka", title: "x", date: "2026-11-08", slot: "noon" },
        "create",
      ).ok,
    ).toBe(false);
    expect(
      validateScheduleInput(
        {
          datasetId: "nonoka",
          title: "x",
          date: "2026-11-08",
          slot: "late",
          videoId: "short",
        },
        "create",
      ).ok,
    ).toBe(false);
  });

  it("PATCH 必须带 eventKey", () => {
    expect(
      validateScheduleInput({ datasetId: "nonoka", title: "x", date: "2026-11-08", slot: "late" }, "patch").ok,
    ).toBe(false);
    expect(
      validateScheduleInput(
        {
          datasetId: "nonoka",
          eventKey: "manual:2026-11-08-late",
          title: "x",
          date: "2026-11-08",
          slot: "late",
        },
        "patch",
      ).ok,
    ).toBe(true);
  });
});
