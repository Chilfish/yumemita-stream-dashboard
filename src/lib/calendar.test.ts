import { describe, expect, it } from "vitest";
import {
  agendaDayLabel,
  buildCalendarEvents,
  buildMonthGrid,
  calendarWindow,
  deriveCalendarEventState,
  groupEventsByDate,
  jstDateKey,
  monthRange,
  parseCalendarParams,
  shiftMonth,
  writeCalendarParams,
} from "./calendar";
import type { CalendarEventInput, CalendarMember } from "@/types/calendar";

const member: CalendarMember = {
  id: "nonoka",
  label: "宮永ののか",
  color: "#b8461f",
  avatar: null,
  streamCount: 0,
};

function input(overrides: Partial<CalendarEventInput> = {}): CalendarEventInput {
  return {
    key: "schedule:test",
    datasetId: "nonoka",
    videoId: "abc12345678",
    title: "雑談",
    at: "2026-11-08T20:00:00+09:00",
    endAt: null,
    expectedMinutes: 120,
    cancelled: false,
    hasStream: false,
    lastLiveAt: null,
    memberOnly: false,
    source: "youtube",
    href: null,
    url: null,
    ...overrides,
  };
}

describe("deriveCalendarEventState", () => {
  const now = new Date("2026-11-08T19:00:00+09:00");

  it("取消优先于已入库", () => {
    expect(deriveCalendarEventState(input({ cancelled: true, hasStream: true }), now)).toBe("cancelled");
  });

  it("同 video_id 已入库就是已结束", () => {
    expect(deriveCalendarEventState(input({ hasStream: true }), now)).toBe("done");
  });

  it("频道检查到 is_live 时是直播中", () => {
    expect(
      deriveCalendarEventState(
        input({ lastLiveAt: new Date(now.getTime() - 60 * 60_000).toISOString() }),
        now,
      ),
    ).toBe("live");
  });

  it("没有时间也没有直播标记时是日期待定", () => {
    expect(deriveCalendarEventState(input({ at: null }), now)).toBe("undated");
  });

  it("开播前是预定", () => {
    expect(deriveCalendarEventState(input(), new Date("2026-11-08T18:00:00+09:00"))).toBe("upcoming");
  });

  it("预计窗口内是直播中", () => {
    expect(deriveCalendarEventState(input(), new Date("2026-11-08T21:40:00+09:00"))).toBe("live");
  });

  it("超过预计窗口仍未入库是待补录", () => {
    expect(deriveCalendarEventState(input(), new Date("2026-11-09T01:00:00+09:00"))).toBe("pending");
  });
});

describe("日期分组", () => {
  it("23:59 JST 归到当天，而不是 UTC 次日", () => {
    expect(jstDateKey("2026-11-08T23:59:00+09:00")).toBe("2026-11-08");
    expect(jstDateKey("2026-11-08T15:30:00Z")).toBe("2026-11-09");
  });

  it("月网格从周日开始，并补齐前后整周", () => {
    const weeks = buildMonthGrid("2026-11", new Date("2026-11-08T12:00:00+09:00"));
    const flat = weeks.flatMap(week => week.days);

    expect(weeks[0]?.days[0]?.date).toBe("2026-11-01");
    expect(weeks[0]?.days).toHaveLength(7);
    expect(flat.length % 7).toBe(0);
    expect(flat.length).toBeGreaterThanOrEqual(35);
    expect(flat.find(day => day.date === "2026-11-08")?.isToday).toBe(true);
    expect(flat.find(day => day.date === "2026-11-01")?.inMonth).toBe(true);
    expect(flat.find(day => day.date === "2026-12-01")?.inMonth).toBe(false);
  });

  it("按 JST 自然日分组", () => {
    const events = buildCalendarEvents({
      streams: [],
      schedules: [
        input({ key: "a", at: "2026-11-08T23:59:00+09:00" }),
        input({ key: "b", at: "2026-11-09T00:01:00+09:00", videoId: "def12345678" }),
      ],
      members: [member],
      now: new Date("2026-11-08T12:00:00+09:00"),
    });
    const grouped = groupEventsByDate(events);

    expect(grouped.get("2026-11-08")).toHaveLength(1);
    expect(grouped.get("2026-11-09")).toHaveLength(1);
  });
});

describe("buildCalendarEvents", () => {
  it("同一 video_id 只保留已入库的场次", () => {
    const events = buildCalendarEvents({
      streams: [
        input({ key: "stream:abc", source: "stream", hasStream: true, href: "/nonoka/stream/abc12345678" }),
      ],
      schedules: [input({ key: "schedule:abc" })],
      members: [member],
      now: new Date("2026-11-09T12:00:00+09:00"),
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.state).toBe("done");
    expect(events[0]?.memberLabel).toBe("宮永ののか");
  });

  it("自动同步优先于手工行", () => {
    const events = buildCalendarEvents({
      streams: [],
      schedules: [
        input({ key: "manual", source: "manual", title: "手工" }),
        input({ key: "youtube", source: "youtube", title: "自动" }),
      ],
      members: [member],
      now: new Date("2026-11-08T12:00:00+09:00"),
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe("自动");
  });
});

describe("议程日头", () => {
  const now = new Date("2026-11-05T12:00:00+09:00");

  it("今天和明天补上日期，其余只出现一次星期", () => {
    expect(agendaDayLabel("2026-11-05", now)).toBe("今天 · 11 月 5 日 · 周四");
    expect(agendaDayLabel("2026-11-06", now)).toBe("明天 · 11 月 6 日 · 周五");
    expect(agendaDayLabel("2026-10-04", now)).toBe("10 月 4 日 · 周日");
  });
});

describe("月份窗口", () => {
  it("前后月份计算", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(calendarWindow("2026-11", 1, 1)).toEqual({ start: "2026-10", end: "2026-12" });
    expect(monthRange("2026-02")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
      next: "2026-03",
    });
  });
});

describe("URL 参数", () => {
  it("默认值不写进 URL", () => {
    const params = parseCalendarParams(new URLSearchParams(), "2026-11");
    const written = writeCalendarParams(new URLSearchParams("keep=1"), params, "2026-11");

    expect(params).toEqual({ month: "2026-11", day: null, members: [], view: null });
    expect(written.toString()).toBe("keep=1");
  });

  it("成员去重并保留显式视图", () => {
    const params = parseCalendarParams(
      new URLSearchParams("month=2026-12&day=2026-12-08&members=a,b,a&view=agenda"),
      "2026-11",
    );

    expect(params).toEqual({
      month: "2026-12",
      day: "2026-12-08",
      members: ["a", "b"],
      view: "agenda",
    });
  });

  it("非法月份和日期回退", () => {
    const params = parseCalendarParams(
      new URLSearchParams("month=2026-13&day=2026-02-30"),
      "2026-11",
    );

    expect(params.month).toBe("2026-11");
    expect(params.day).toBeNull();
  });

  it("只带 day 时用 day 所在的月份", () => {
    const params = parseCalendarParams(
      new URLSearchParams("day=2026-10-06"),
      "2026-11",
    );

    expect(params.month).toBe("2026-10");
    expect(params.day).toBe("2026-10-06");
  });
});
