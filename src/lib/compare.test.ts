import { describe, expect, it } from "vitest";
import {
  buildCompareBuckets,
  buildCompareView,
  monthKeyOf,
  type CompareStreamRow,
} from "./compare";
import type { CompareParams } from "@/types/compare";
import type { DatasetIndexEntry } from "@/types/dataset";

const DATASETS: DatasetIndexEntry[] = [
  {
    id: "a",
    label: "A",
    color: "#a00",
    channelId: null,
    count: 0,
    generatedAt: null,
    manifest: "",
  },
  {
    id: "b",
    label: "B",
    color: null,
    channelId: null,
    count: 0,
    generatedAt: null,
    manifest: "",
  },
];

function row(overrides: Partial<CompareStreamRow> & Pick<CompareStreamRow, "datasetId">): CompareStreamRow {
  return {
    title: "雑談",
    date: "2026-09-01",
    startedAt: "2026-09-01T10:00:00Z",
    durationSec: 3600,
    avgConcurrent: 100,
    chatTotal: 600,
    superchats: 10,
    commentsCaptured: 20,
    ...overrides,
  };
}

const ROWS: CompareStreamRow[] = [
  row({ datasetId: "a", title: "歌枠", date: "2026-07-01" }),
  row({
    datasetId: "a",
    title: "歌枠",
    date: "2026-09-01",
    durationSec: 3600,
    avgConcurrent: 100,
    chatTotal: 600,
    superchats: 10,
    commentsCaptured: 20,
  }),
  row({
    datasetId: "a",
    title: "歌枠",
    date: "2026-10-05",
    durationSec: 1800,
    avgConcurrent: 50,
    chatTotal: 100,
    superchats: 5,
    commentsCaptured: null,
  }),
  row({
    datasetId: "b",
    title: "雑談",
    date: "2026-10-10",
    durationSec: 7200,
    avgConcurrent: null,
    chatTotal: 900,
    superchats: 30,
    commentsCaptured: 40,
  }),
  row({
    datasetId: "b",
    title: "ゲーム",
    date: "2026-08-10",
    durationSec: 0,
    avgConcurrent: 10,
    chatTotal: 10,
    superchats: 0,
    commentsCaptured: 0,
  }),
];

const DEFAULT_PARAMS: CompareParams = {
  members: ["a", "b"],
  type: null,
  months: 6,
};

describe("monthKeyOf", () => {
  it("uses the JST date when present", () => {
    expect(monthKeyOf({ date: "2026-09-30", startedAt: null })).toBe("2026-09");
  });

  it("falls back to the JST month of startedAt", () => {
    expect(monthKeyOf({ date: null, startedAt: "2026-09-30T20:00:00Z" })).toBe("2026-10");
    expect(monthKeyOf({ date: null, startedAt: null })).toBeNull();
  });
});

describe("buildCompareBuckets", () => {
  it("writes both the concrete type and the all bucket", () => {
    const buckets = buildCompareBuckets(ROWS);
    expect(buckets).toHaveLength(ROWS.length * 2);

    const sing = buckets.find(
      bucket => bucket.memberId === "a" && bucket.month === "2026-09" && bucket.type === "sing",
    );
    const all = buckets.find(
      bucket => bucket.memberId === "a" && bucket.month === "2026-09" && bucket.type === "all",
    );
    expect(sing?.streams).toBe(1);
    expect(all?.streams).toBe(1);
    expect(sing?.chatTotal).toBe(600);
  });

  it("aggregates weighted concurrent and comments coverage", () => {
    const buckets = buildCompareBuckets(ROWS);
    const october = buckets.find(
      bucket => bucket.memberId === "b" && bucket.month === "2026-10" && bucket.type === "all",
    );
    expect(october?.concurrentWeighted).toBe(0);
    expect(october?.concurrentDuration).toBe(0);
    expect(october?.commentsCaptured).toBe(40);
    expect(october?.commentsStreams).toBe(1);
  });
});

describe("buildCompareView", () => {
  it("aligns months and aggregates a member over the window", () => {
    const view = buildCompareView(buildCompareBuckets(ROWS), DATASETS, DEFAULT_PARAMS);

    expect(view.months).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    const a = view.members.find(member => member.id === "a");
    expect(a?.streams).toBe(3);
    expect(a?.durationSec).toBe(9000);
    expect(a?.avgConcurrent).toBeCloseTo((100 * 7200 + 50 * 1800) / 9000);
    expect(a?.chatPerMinute).toBeCloseTo(1300 / 150);
    expect(a?.scPerHour).toBeCloseTo(25 / 2.5);
    expect(a?.commentsPerStream).toBe(20);
    expect(a?.sampleSufficient).toBe(true);
  });

  it("keeps missing months null (streams are a real zero)", () => {
    const view = buildCompareView(buildCompareBuckets(ROWS), DATASETS, DEFAULT_PARAMS);
    const streams = view.series.find(series => series.key === "streams");
    const avg = view.series.find(series => series.key === "avgConcurrent");

    expect(streams?.values.a).toEqual([1, 0, 1, 1]);
    expect(avg?.values.a?.[1]).toBeNull();
    expect(avg?.values.b?.[2]).toBeNull();
  });

  it("labels small samples", () => {
    const view = buildCompareView(buildCompareBuckets(ROWS), DATASETS, DEFAULT_PARAMS);
    const b = view.members.find(member => member.id === "b");
    expect(b?.streams).toBe(2);
    expect(b?.sampleSufficient).toBe(false);
  });

  it("filters by content type", () => {
    const view = buildCompareView(buildCompareBuckets(ROWS), DATASETS, {
      ...DEFAULT_PARAMS,
      type: "sing",
    });
    const b = view.members.find(member => member.id === "b");
    expect(b?.streams).toBe(0);
    expect(b?.chatPerMinute).toBeNull();

    const a = view.members.find(member => member.id === "a");
    expect(a?.streams).toBe(3);
  });

  it("slices the window from the latest data month", () => {
    const view = buildCompareView(buildCompareBuckets(ROWS), DATASETS, {
      ...DEFAULT_PARAMS,
      months: 3,
    });
    expect(view.months).toEqual(["2026-08", "2026-09", "2026-10"]);
  });

  it("returns null rates when duration is zero", () => {
    const view = buildCompareView(buildCompareBuckets(ROWS), DATASETS, {
      ...DEFAULT_PARAMS,
      type: "game",
    });
    const b = view.members.find(member => member.id === "b");
    expect(b?.streams).toBe(1);
    expect(b?.durationSec).toBe(0);
    expect(b?.chatPerMinute).toBeNull();
    expect(b?.scPerHour).toBeNull();
  });

  it("sums only the selected members in totals", () => {
    const view = buildCompareView(buildCompareBuckets(ROWS), DATASETS, {
      ...DEFAULT_PARAMS,
      members: ["b"],
    });
    expect(view.members).toHaveLength(1);
    expect(view.totals.streams).toBe(2);
    expect(view.totals.chatTotal).toBe(910);
  });
});
