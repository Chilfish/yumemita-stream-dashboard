import { describe, expect, it } from "vitest";
import {
  planScheduleConsolidation,
  planSchedulePrune,
  type ScheduleRef,
  type StreamRef,
} from "./schedule-match";

function stream(overrides: Partial<StreamRef> = {}): StreamRef {
  return {
    datasetId: "miyako",
    videoId: "L_WHcvB4dfQ",
    title: "【ASMR】社訓よみきかせ",
    date: "2026-11-11",
    startedAt: "2026-11-11T12:30:00Z",
    endedAt: "2026-11-11T14:30:00Z",
    availability: "public",
    ...overrides,
  };
}

function schedule(overrides: Partial<ScheduleRef> = {}): ScheduleRef {
  return {
    datasetId: "miyako",
    eventKey: "manual:2026-11-11-late",
    videoId: null,
    title: "ゲーム",
    url: null,
    date: "2026-11-11",
    slot: "late",
    scheduledAt: null,
    expectedMinutes: null,
    availability: "public",
    cancelledAt: null,
    source: "manual",
    ...overrides,
  };
}

describe("planSchedulePrune", () => {
  it("video_id 命中直接删除", () => {
    const plan = planSchedulePrune(
      [stream()],
      [schedule({ eventKey: "yt:L_WHcvB4dfQ", videoId: "L_WHcvB4dfQ", source: "youtube" })],
    );

    expect(plan).toEqual([
      { datasetId: "miyako", eventKey: "yt:L_WHcvB4dfQ", videoId: "L_WHcvB4dfQ", reason: "video" },
    ]);
  });

  it("手工行按链接里的 video id 命中", () => {
    const plan = planSchedulePrune(
      [stream()],
      [schedule({ url: "https://www.youtube.com/watch?v=L_WHcvB4dfQ" })],
    );

    expect(plan[0]).toMatchObject({ eventKey: "manual:2026-11-11-late", reason: "url" });
  });

  it("没有标题和链接时按成员 + 日期 + 时段命中", () => {
    const plan = planSchedulePrune([stream()], [schedule()]);

    expect(plan[0]).toMatchObject({ eventKey: "manual:2026-11-11-late", reason: "date-slot" });
  });

  it("时段不同不命中，保留待补录", () => {
    const plan = planSchedulePrune(
      [stream({ startedAt: "2026-11-11T00:30:00Z" })],
      [schedule()],
    );

    expect(plan).toEqual([]);
  });

  it("链接指向未入库的视频时，不按日期时段误删", () => {
    const plan = planSchedulePrune(
      [stream()],
      [schedule({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })],
    );

    expect(plan).toEqual([]);
  });

  it("已取消但实际播出的场次也清理", () => {
    const plan = planSchedulePrune(
      [stream()],
      [schedule({ cancelledAt: "2026-11-10T00:00:00Z", url: "https://youtu.be/L_WHcvB4dfQ" })],
    );

    expect(plan[0]?.reason).toBe("url");
  });
});

describe("planScheduleConsolidation", () => {
  it("日期与时段已知的 yt 行改名为自然键", () => {
    const plan = planScheduleConsolidation([
      schedule({
        eventKey: "yt:L_WHcvB4dfQ",
        videoId: "L_WHcvB4dfQ",
        source: "youtube",
        title: "【ASMR】社訓よみきかせ",
        url: "https://www.youtube.com/watch?v=L_WHcvB4dfQ",
      }),
    ]);

    expect(plan).toEqual([
      {
        datasetId: "miyako",
        eventKey: "yt:L_WHcvB4dfQ",
        targetEventKey: "manual:2026-11-11-late",
        action: "rename",
        videoId: "L_WHcvB4dfQ",
        patch: {},
      },
    ]);
  });

  it("自动行与手工行同 video id 时合并到手工行，保留自然键", () => {
    const plan = planScheduleConsolidation([
      schedule({ url: "https://www.youtube.com/watch?v=L_WHcvB4dfQ" }),
      schedule({
        eventKey: "yt:L_WHcvB4dfQ",
        videoId: "L_WHcvB4dfQ",
        source: "youtube",
        date: null,
        slot: null,
      }),
    ]);

    expect(plan).toEqual([
      {
        datasetId: "miyako",
        eventKey: "yt:L_WHcvB4dfQ",
        targetEventKey: "manual:2026-11-11-late",
        action: "merge",
        videoId: "L_WHcvB4dfQ",
        patch: { videoId: "L_WHcvB4dfQ" },
      },
    ]);
  });

  it("没有链接时按日期 + 时段合并到手工行", () => {
    const plan = planScheduleConsolidation([
      schedule({ title: "" }),
      schedule({
        eventKey: "yt:L_WHcvB4dfQ",
        videoId: "L_WHcvB4dfQ",
        source: "youtube",
        title: "自動タイトル",
        url: "https://www.youtube.com/watch?v=L_WHcvB4dfQ",
      }),
    ]);

    expect(plan[0]).toMatchObject({
      action: "merge",
      targetEventKey: "manual:2026-11-11-late",
      patch: { videoId: "L_WHcvB4dfQ", title: "自動タイトル", url: "https://www.youtube.com/watch?v=L_WHcvB4dfQ" },
    });
  });

  it("同一时段有多条自动行时只归一一条，不互相覆盖", () => {
    const plan = planScheduleConsolidation([
      schedule({
        eventKey: "yt:aaaaaaaaaaa",
        videoId: "aaaaaaaaaaa",
        source: "youtube",
      }),
      schedule({
        eventKey: "yt:bbbbbbbbbbb",
        videoId: "bbbbbbbbbbb",
        source: "youtube",
      }),
    ]);

    expect(plan).toHaveLength(1);
    expect(plan[0]?.targetEventKey).toBe("manual:2026-11-11-late");
  });

  it("时间未知的 yt 行保持原样", () => {
    const plan = planScheduleConsolidation([
      schedule({
        eventKey: "yt:L_WHcvB4dfQ",
        videoId: "L_WHcvB4dfQ",
        source: "youtube",
        date: null,
        slot: null,
      }),
    ]);

    expect(plan).toEqual([]);
  });
});
