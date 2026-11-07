import { describe, expect, it } from "vitest";
import { planScheduleEntries } from "./schedule-sync";
import type { ChannelEntry } from "./update-plan";

function entry(overrides: Partial<ChannelEntry> = {}): ChannelEntry {
  return {
    id: "abc12345678",
    title: "雑談",
    durationSec: 7200,
    liveStatus: "is_upcoming",
    scheduledAt: "2026-11-08T20:00:00+09:00",
    ...overrides,
  };
}

describe("planScheduleEntries", () => {
  it("把未来场写成日程，保留时间与预计时长", () => {
    const plan = planScheduleEntries([entry()]);

    expect(plan.live).toEqual([]);
    expect(plan.upcoming).toHaveLength(1);
    expect(plan.upcoming[0]).toMatchObject({
      videoId: "abc12345678",
      eventKey: "yt:abc12345678",
      title: "雑談",
      url: "https://www.youtube.com/watch?v=abc12345678",
      date: "2026-11-08",
      slot: "late",
      expectedMinutes: 120,
    });
    expect(plan.upcoming[0]?.scheduledAt?.toISOString()).toBe(
      new Date("2026-11-08T20:00:00+09:00").toISOString(),
    );
  });

  it("没有精确时间时保留空时间，进日期待定", () => {
    const plan = planScheduleEntries([
      entry({ scheduledAt: null, durationSec: null }),
    ]);

    expect(plan.upcoming[0]?.scheduledAt).toBeNull();
    expect(plan.upcoming[0]?.date).toBeNull();
    expect(plan.upcoming[0]?.slot).toBeNull();
    expect(plan.upcoming[0]?.expectedMinutes).toBeNull();
  });

  it("直播中只记 videoId，不新建日程", () => {
    const plan = planScheduleEntries([
      entry({ id: "live1234567", liveStatus: "is_live" }),
    ]);

    expect(plan.upcoming).toEqual([]);
    expect(plan.live).toEqual(["live1234567"]);
  });

  it("已经入库的场次跳过", () => {
    const plan = planScheduleEntries([entry()], {
      knownIds: new Set(["abc12345678"]),
    });

    expect(plan.upcoming).toEqual([]);
    expect(plan.live).toEqual([]);
  });

  it("同一 videoId 只保留一次，标题为空时用占位文案", () => {
    const plan = planScheduleEntries([
      entry({ title: null }),
      entry({ title: "重复" }),
    ]);

    expect(plan.upcoming).toHaveLength(1);
    expect(plan.upcoming[0]?.title).toBe("未命名直播");
  });
});
