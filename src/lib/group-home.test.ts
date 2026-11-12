import { describe, expect, it } from "vitest";
import {
  buildAttendance,
  buildMemberStandings,
  buildRecentTrend,
  buildWeekActivity,
  MEMBER_METRICS,
  memberAccentColor,
  memberMetric,
  primaryReadout,
  recentUpdates,
  relativeDayLabel,
  secondaryReadout,
  splitHeroMembers,
} from "./group-home";
import type { GroupMemberSummary, GroupStreamRow } from "./group";
import type { DatasetIndexEntry } from "@/types/dataset";
import type { GroupDayStat } from "@/types/group";

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
    ownerDatasetId: "a",
    participantLabels: [],
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

describe("buildAttendance", () => {
  const a = member(dataset("a", "A", "#111111"), {
    latest: stream({ datasetId: "a", startedAt: "2026-10-30T12:00:00+09:00" }),
  });
  const b = member(dataset("b", "B", "#222222"), {
    latest: stream({ datasetId: "b", startedAt: "2026-10-28T12:00:00+09:00" }),
  });
  const days: GroupDayStat[] = [
    { datasetId: "a", date: "2026-10-26", streams: 2, chat: 300 },
    { datasetId: "a", date: "2026-10-30", streams: 1, chat: 100 },
    { datasetId: "b", date: "2026-10-28", streams: 1, chat: 50 },
    { datasetId: "b", date: "2026-09-01", streams: 3, chat: 999 },
  ];

  it("fills empty days into a week-by-weekday grid", () => {
    const view = buildAttendance([a, b], days, "2026-10-25", "2026-10-30");
    expect(view.days).toBe(6);
    expect(view.weeks).toBe(2);
    expect(view.rows.map(row => row.id)).toEqual(["a", "b"]);
    expect(view.rows[0]?.cells).toHaveLength(14);
    expect(view.rows[0]?.cells.filter(cell => cell === null)).toHaveLength(8);

    const filled = view.rows[0]?.cells.flatMap(cell => (cell ? [cell] : [])) ?? [];
    expect(filled.map(cell => cell.date)).toEqual([
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
    ]);
    expect(filled.map(cell => cell.streams)).toEqual([0, 2, 0, 0, 0, 1]);
    expect(filled.find(cell => cell.date === "2026-10-26")?.weekday).toBe(0);
    expect(view.axis).toEqual([{ label: "10/25", week: 0 }]);
    expect(view.rows[0]?.totalStreams).toBe(3);
    expect(view.totalStreams).toBe(4);
    expect(view.maxStreams).toBe(2);
  });

  it("drops buckets outside the window and keeps idle members", () => {
    const idle = member(dataset("c", "C"));
    const view = buildAttendance([a, b, idle], days, "2026-10-25", "2026-10-30");
    expect(view.rows.at(-1)?.id).toBe("c");
    expect(view.rows.at(-1)?.totalStreams).toBe(0);
    expect(view.rows.at(-1)?.cells.every(cell => cell === null || cell.streams === 0)).toBe(true);
    expect(view.totalChat).toBe(450);
  });

  it("labels every fourth week from the window start", () => {
    const view = buildAttendance([a], [], "2026-07-28", "2026-11-04");
    expect(view.days).toBe(100);
    expect(view.weeks).toBe(15);
    expect(view.rows[0]?.cells).toHaveLength(105);
    expect(view.axis).toEqual([
      { label: "7/28", week: 0 },
      { label: "8/24", week: 4 },
      { label: "9/21", week: 8 },
      { label: "10/19", week: 12 },
    ]);
  });

  it("returns an empty grid for an invalid range", () => {
    const view = buildAttendance([a], days, "not-a-date", "2026-10-30");
    expect(view.days).toBe(0);
    expect(view.weeks).toBe(0);
    expect(view.axis).toEqual([]);
    expect(view.rows[0]?.cells).toEqual([]);
    expect(view.maxStreams).toBe(1);
  });
});

describe("buildMemberStandings", () => {
  const a = member(dataset("a", "A", "#111111"), {
    streamCount: 3,
    durationSec: 3 * 3600,
    chatTotal: 100,
    superchats: 2,
    avgConcurrent: 10,
  });
  const b = member(dataset("b", "B", "#222222"), {
    streamCount: 1,
    durationSec: 3600,
    chatTotal: 300,
    superchats: 5,
    avgConcurrent: 30,
  });
  const c = member(dataset("c", "C", "#333333"), {
    streamCount: 2,
    durationSec: 2 * 3600,
    chatTotal: 200,
    superchats: 1,
    avgConcurrent: null,
  });

  it("sorts by the selected metric and shares the additive total", () => {
    expect(buildMemberStandings([a, b, c], "streams").map(row => row.id)).toEqual([
      "a",
      "c",
      "b",
    ]);

    const chat = buildMemberStandings([a, b, c], "chat");
    expect(chat.map(row => row.id)).toEqual(["b", "c", "a"]);
    expect(chat[0]?.share).toBeCloseTo(0.5);
    expect(buildMemberStandings([a, b, c], "duration")[0]?.value).toBeCloseTo(3);
  });

  it("keeps null metrics last and gives them no share", () => {
    const rows = buildMemberStandings([a, b, c], "concurrent");
    expect(rows.map(row => row.id)).toEqual(["b", "a", "c"]);
    expect(rows.at(-1)?.value).toBeNull();
    expect(rows.at(-1)?.share).toBeNull();
    expect(rows.every(row => row.share == null)).toBe(true);
  });

  it("exposes the metric labels and formats", () => {
    expect(MEMBER_METRICS.map(option => option.key)).toEqual([
      "streams",
      "duration",
      "chat",
      "superchats",
      "concurrent",
    ]);
    expect(memberMetric("duration").unit).toBe("小时");
  });
});

describe("buildRecentTrend", () => {
  const rows = [
    stream({ videoId: "new", chatTotal: 120, durationSec: 3600 }),
    stream({
      videoId: "member",
      chatTotal: 999,
      durationSec: 3600,
      availability: "subscriber_only",
    }),
    stream({ videoId: "missing", chatTotal: 0, durationSec: 3600 }),
    stream({ videoId: "old", chatTotal: 90, durationSec: 1800 }),
  ];

  it("keeps public rows with duration and returns oldest first", () => {
    const trend = buildRecentTrend(rows, 20);
    expect(trend.map(point => point.videoId)).toEqual(["old", "new"]);
    expect(trend.map(point => point.value)).toEqual([3, 2]);
  });

  it("respects the limit before reversing", () => {
    expect(buildRecentTrend(rows, 1).map(point => point.videoId)).toEqual(["new"]);
  });

  it("returns nothing for a non-positive limit", () => {
    expect(buildRecentTrend(rows, 0)).toEqual([]);
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
