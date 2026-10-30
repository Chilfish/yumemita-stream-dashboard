import { describe, expect, it } from "vitest";
import {
  buildWeekActivity,
  memberAccentColor,
  primaryReadout,
  recentUpdates,
  relativeDayLabel,
  secondaryReadout,
  splitHeroMembers,
} from "./group-home";
import type { GroupMemberSummary, GroupStreamRow } from "./group";
import type { DatasetIndexEntry } from "@/types/dataset";

function dataset(id: string, label: string, color?: string | null): DatasetIndexEntry {
  return {
    id,
    label,
    color,
    channelId: null,
    count: 0,
    generatedAt: null,
    manifest: `${id}/manifest.json`,
  };
}

function stream(overrides: Partial<GroupStreamRow> = {}): GroupStreamRow {
  return {
    datasetId: "a",
    memberLabel: "A",
    memberColor: "#b8461f",
    date: "2026-10-29",
    videoId: "vid",
    title: "配信",
    startedAt: "2026-10-29T12:00:00+09:00",
    durationSec: 3600,
    availability: null,
    avgConcurrent: null,
    maxConcurrent: null,
    chatTotal: 100,
    superchats: 0,
    vstatsViews: null,
    snapshotViews: null,
    thumbnail: null,
    ...overrides,
  };
}

function member(
  datasetEntry: DatasetIndexEntry,
  overrides: Partial<GroupMemberSummary> = {},
): GroupMemberSummary {
  return {
    dataset: datasetEntry,
    latest: null,
    streamCount: 0,
    chatTotal: 0,
    superchats: 0,
    durationSec: 0,
    weekStreams: 0,
    weekChat: 0,
    monthStreams: 0,
    avgConcurrent: null,
    ...overrides,
  };
}

describe("splitHeroMembers", () => {
  const older = member(dataset("a", "A"), {
    latest: stream({ startedAt: "2026-10-01T12:00:00+09:00" }),
    streamCount: 3,
  });
  const newest = member(dataset("b", "B"), {
    latest: stream({ startedAt: "2026-10-29T12:00:00+09:00" }),
    streamCount: 1,
  });
  const newer = member(dataset("c", "C"), {
    latest: stream({ startedAt: "2026-10-20T12:00:00+09:00" }),
    streamCount: 2,
  });
  const idle = member(dataset("d", "D"));

  it("makes the most recent streamer the focus and keeps the rest ordered", () => {
    const split = splitHeroMembers([older, newest, idle, newer]);
    expect(split.focus?.dataset.id).toBe("b");
    expect(split.rest.map(item => item.dataset.id)).toEqual(["c", "a", "d"]);
    expect(split.idle.map(item => item.dataset.id)).toEqual(["d"]);
  });

  it("has no focus but keeps every member when nobody has streamed", () => {
    const split = splitHeroMembers([idle, member(dataset("e", "E"))]);
    expect(split.focus).toBeNull();
    expect(split.rest.map(item => item.dataset.id)).toEqual(["d", "e"]);
    expect(split.idle).toHaveLength(2);
  });

  it("handles an empty roster", () => {
    expect(splitHeroMembers([])).toEqual({ focus: null, rest: [], idle: [] });
  });
});

describe("memberAccentColor", () => {
  it("uses the raw dataset color and falls back to the default accent", () => {
    expect(memberAccentColor(member(dataset("a", "A", "#ffa7e4")))).toBe("#ffa7e4");
    expect(memberAccentColor(member(dataset("b", "B", null)))).toBe("#b8461f");
    expect(memberAccentColor(member(dataset("c", "C")))).toBe("#b8461f");
  });
});

describe("readouts", () => {
  it("prefers peak concurrent viewers when VSTATS data exists", () => {
    const row = stream({ maxConcurrent: 1200, chatTotal: 3400, superchats: 9 });
    expect(primaryReadout(row)).toEqual({ label: "峰值同接", unit: "人", value: 1200 });
    expect(secondaryReadout(row)).toEqual({ label: "弹幕", unit: "条", value: 3400 });
  });

  it("falls back to chat and superchats when peak concurrent is missing", () => {
    const row = stream({ maxConcurrent: null, chatTotal: 3400, superchats: 9 });
    expect(primaryReadout(row)).toEqual({ label: "弹幕", unit: "条", value: 3400 });
    expect(secondaryReadout(row)).toEqual({ label: "SC", unit: "笔", value: 9 });
  });

  it("reports missing chat as null instead of a fake zero", () => {
    const row = stream({ maxConcurrent: 1327, chatTotal: 0, superchats: 0 });
    expect(primaryReadout(row)).toEqual({ label: "峰值同接", unit: "人", value: 1327 });
    expect(secondaryReadout(row)).toEqual({ label: "弹幕", unit: "条", value: null });
  });
});

describe("buildWeekActivity", () => {
  it("orders members by week streams and splits shares over the group total", () => {
    const activity = buildWeekActivity([
      member(dataset("a", "A", "#111111"), { weekStreams: 1 }),
      member(dataset("b", "B", "#222222"), { weekStreams: 3 }),
      member(dataset("c", "C", "#333333"), { weekStreams: 0 }),
    ]);

    expect(activity.total).toBe(4);
    expect(activity.entries.map(entry => entry.id)).toEqual(["b", "a", "c"]);
    expect(activity.entries[0]?.share).toBeCloseTo(0.75);
    expect(activity.entries.at(-1)?.share).toBe(0);
    expect(activity.segments.map(entry => entry.id)).toEqual(["b", "a"]);
    expect(activity.segments.reduce((sum, entry) => sum + entry.share, 0)).toBeCloseTo(1);
  });

  it("keeps the entries but no segments for a quiet week", () => {
    const activity = buildWeekActivity([member(dataset("a", "A"))]);
    expect(activity.total).toBe(0);
    expect(activity.entries).toHaveLength(1);
    expect(activity.segments).toEqual([]);
  });
});

describe("recentUpdates", () => {
  const rows: GroupStreamRow[] = ["a", "b", "c"].map((videoId, index) => ({
    ...stream({ videoId }),
    datasetId: "nonoka",
    memberLabel: "宮永ののか",
    memberColor: "#ffa7e4",
    rank: index,
  }));

  it("takes the newest rows without re-sorting", () => {
    expect(recentUpdates(rows, 2).map(row => row.videoId)).toEqual(["a", "b"]);
  });

  it("returns everything when the limit exceeds the row count", () => {
    expect(recentUpdates(rows, 8)).toHaveLength(3);
    expect(recentUpdates(rows, 0)).toEqual([]);
  });
});

describe("relativeDayLabel", () => {
  const now = new Date("2026-10-30T03:00:00Z"); // 2026-10-30 12:00 JST

  it("calls today and yesterday out by name", () => {
    expect(relativeDayLabel("2026-10-30T01:00:00+09:00", now)).toBe("今天");
    expect(relativeDayLabel("2026-10-29T23:30:00+09:00", now)).toBe("昨天");
    expect(relativeDayLabel("2026-10-27T23:30:00+09:00", now)).toBe("3 天前");
  });

  it("rolls over at JST midnight rather than UTC", () => {
    // 2026-10-30T15:30Z 已经是 JST 的 10-31。
    const afterMidnight = new Date("2026-10-30T15:30:00Z");
    expect(relativeDayLabel("2026-10-30T20:00:00+09:00", afterMidnight)).toBe("昨天");
  });

  it("switches to weeks, months, then nothing", () => {
    expect(relativeDayLabel("2026-10-16T12:00:00+09:00", now)).toBe("2 周前");
    expect(relativeDayLabel("2026-08-20T12:00:00+09:00", now)).toBe("2 个月前");
    expect(relativeDayLabel("2024-01-01T12:00:00+09:00", now)).toBeNull();
  });

  it("tolerates missing or malformed timestamps", () => {
    expect(relativeDayLabel(null, now)).toBeNull();
    expect(relativeDayLabel("2026-10-30T25:99:00+09:00", now)).toBeNull();
    expect(relativeDayLabel("2026-10-31T12:00:00+09:00", now)).toBe("今天");
  });
});
