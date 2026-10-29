import { describe, expect, it } from "vitest";
import {
  buildGroupData,
  jstDateKey,
  shiftDateKey,
  sortMembersByLatest,
  weekStartKey,
} from "./group";
import type { BatchManifest, DatasetIndexEntry, StreamSummary } from "@/types/dataset";

function member(id: string, label: string): DatasetIndexEntry {
  return {
    id,
    label,
    color: "#ffcb5b",
    channelId: null,
    count: 0,
    generatedAt: null,
    manifest: `${id}/manifest.json`,
  };
}

function stream(overrides: Partial<StreamSummary> & { videoId: string; date: string }): StreamSummary {
  return {
    rank: 0,
    title: overrides.videoId,
    url: `https://www.youtube.com/watch?v=${overrides.videoId}`,
    durationHms: null,
    durationSec: 3600,
    startedAt: `${overrides.date}T10:00:00Z`,
    endedAt: null,
    availability: null,
    avgConcurrent: null,
    maxConcurrent: null,
    maxConcurrentAt: null,
    watchTimeHours: null,
    vstatsViews: null,
    vstatsLikes: null,
    snapshotViews: null,
    snapshotLikes: null,
    snapshotComments: null,
    chatTotal: 100,
    chatByKind: { text: 100, superchat: 0, sticker: 0, membership: 0 },
    pureEmojiOnly: 0,
    uniqueAuthors: 0,
    superchats: 0,
    scTotalsByCurrency: {},
    stickers: 0,
    memberships: 0,
    commentsCaptured: null,
    chatPer1000AvgViewers: null,
    likesPer1000Views: null,
    scPerHour: null,
    sessionDir: "",
    datapack: `${overrides.videoId}.datapack.json`,
    generatedAt: "",
    ...overrides,
  };
}

function manifest(streams: StreamSummary[]): BatchManifest {
  return {
    schema: "v1",
    generatedAt: "",
    subject: "",
    channelId: null,
    scope: "",
    count: streams.length,
    note: "",
    streams,
  };
}

describe("jstDateKey", () => {
  it("rolls over at JST midnight rather than UTC", () => {
    expect(jstDateKey(new Date("2026-10-28T14:59:00Z"))).toBe("2026-10-28");
    expect(jstDateKey(new Date("2026-10-28T15:30:00Z"))).toBe("2026-10-29");
  });
});

describe("shiftDateKey / weekStartKey", () => {
  it("crosses month boundaries", () => {
    expect(shiftDateKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDateKey("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("starts the 7-day window six days before today", () => {
    expect(weekStartKey(new Date("2026-10-29T03:00:00Z"))).toBe("2026-10-23");
  });
});

describe("buildGroupData", () => {
  const now = new Date("2026-10-29T03:00:00Z");
  const datasets = [member("nonoka", "宮永ののか"), member("arale", "仲町あられ")];
  const manifests = new Map<string, BatchManifest>([
    [
      "nonoka",
      manifest([
        stream({ videoId: "new", date: "2026-10-28", chatTotal: 500, avgConcurrent: 1000 }),
        stream({ videoId: "old", date: "2026-09-30", chatTotal: 300, avgConcurrent: 500 }),
      ]),
    ],
    [
      "arale",
      manifest([
        stream({ videoId: "mid", date: "2026-10-20", chatTotal: 200, avgConcurrent: 2000 }),
      ]),
    ],
  ]);

  it("merges rows across members and keeps them newest first", () => {
    const data = buildGroupData(datasets, manifests, now);
    expect(data.rows.map(row => row.videoId)).toEqual(["new", "mid", "old"]);
    expect(data.rows[0]?.datasetId).toBe("nonoka");
    expect(data.rows[1]?.memberLabel).toBe("仲町あられ");
  });

  it("rolls up totals and per-member windows", () => {
    const data = buildGroupData(datasets, manifests, now);
    expect(data.totals.streamCount).toBe(3);
    expect(data.totals.chatTotal).toBe(1000);
    expect(data.totals.weekStreams).toBe(1);
    expect(data.totals.weekChat).toBe(500);
    expect(data.totals.monthStreams).toBe(2);

    const nonoka = data.members.find(item => item.dataset.id === "nonoka");
    expect(nonoka?.weekStreams).toBe(1);
    expect(nonoka?.monthStreams).toBe(1);
    expect(nonoka?.latest?.videoId).toBe("new");
    expect(nonoka?.avgConcurrent).toBe(750);
  });

  it("skips datasets whose manifest failed to load", () => {
    const partial = new Map([...manifests].filter(([id]) => id === "arale"));
    const data = buildGroupData(datasets, partial, now);
    expect(data.members).toHaveLength(1);
    expect(data.members[0]?.dataset.id).toBe("arale");
    expect(data.totals.streamCount).toBe(1);
  });
});

describe("sortMembersByLatest", () => {
  it("puts the most recent streamer first and never-streamed members last", () => {
    const now = new Date("2026-10-29T03:00:00Z");
    const datasets = [member("a", "A"), member("b", "B"), member("c", "C")];
    const manifests = new Map<string, BatchManifest>([
      ["a", manifest([stream({ videoId: "a1", date: "2026-10-01" })])],
      ["b", manifest([stream({ videoId: "b1", date: "2026-10-28" })])],
      ["c", manifest([])],
    ]);
    const sorted = sortMembersByLatest(buildGroupData(datasets, manifests, now).members);
    expect(sorted.map(item => item.dataset.id)).toEqual(["b", "a", "c"]);
  });
});
