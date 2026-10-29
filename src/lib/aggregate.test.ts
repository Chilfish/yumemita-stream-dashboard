import { describe, expect, it } from "vitest";
import type { StreamDatapack } from "@/types/datapack";
import type { StreamSummary } from "@/types/dataset";
import {
  aggregateDataset,
  buildCalendarDays,
  buildContentTypeStats,
  buildMonthlySeries,
  buildStreamRows,
  buildStreamShape,
  buildSummaryRows,
  calendarMetricValue,
  currencyRows,
  findStreamRow,
  findStreamSummary,
  percentChange,
} from "./aggregate";

function makeSummary(
  overrides: Partial<StreamSummary> & {
    videoId: string;
    startedAt: string | null;
    durationSec: number;
  },
): StreamSummary {
  return {
    rank: 1,
    date: overrides.startedAt?.slice(0, 10) ?? "",
    title: `stream ${overrides.videoId}`,
    url: `https://www.youtube.com/watch?v=${overrides.videoId}`,
    durationHms: "1:00:00",
    endedAt: null,
    availability: "public",
    avgConcurrent: null,
    maxConcurrent: null,
    maxConcurrentAt: null,
    watchTimeHours: null,
    vstatsViews: null,
    vstatsLikes: null,
    snapshotViews: null,
    snapshotLikes: null,
    snapshotComments: null,
    chatTotal: 0,
    chatByKind: { text: 0, superchat: 0, sticker: 0, membership: 0 },
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
    datapack: "",
    generatedAt: "",
    ...overrides,
  };
}

interface PackOptions {
  id: string;
  startedAt: string;
  durationSec: number;
  avg: number | null;
  chat: number;
  sc?: { currency: string; amount: number; count: number };
  words?: { word: string; count: number }[];
  authors?: StreamDatapack["chat"]["topAuthors"];
  peakOffset?: number;
  availability?: string;
  views?: number;
  likes?: number;
  comments?: number;
}

function makePack(options: PackOptions): StreamDatapack {
  const { id, startedAt, durationSec, avg, chat } = options;
  const minutes = Math.max(1, Math.ceil(durationSec / 60));
  const peakOffset = options.peakOffset ?? 0;
  const perMinute = Array.from({ length: minutes }, (_, index) =>
    index === peakOffset ? 100 : 0,
  );
  const scCount = options.sc?.count ?? 0;

  return {
    schema: "yumemita.stream-datapack/v1",
    generatedAt: startedAt,
    video: {
      id,
      url: `https://www.youtube.com/watch?v=${id}`,
      title: `stream ${id}`,
      channelId: "channel",
      channelName: "channel",
      channelUrl: null,
      channelFollowersAtCapture: null,
      liveStatus: "was_live",
      availability: options.availability ?? "public",
      startedAt,
      publishedAt: startedAt,
      durationSec,
      durationHms: "1:00:00",
      endedAt: null,
      thumbnail: null,
      description: null,
      links: [],
      chapters: [],
      hasLiveChatReplay: true,
      captionsJa: true,
      snapshot: {
        views: options.views ?? 1000,
        likes: options.likes ?? 100,
        comments: options.comments ?? 0,
      },
    },
    vstats:
      avg == null
        ? null
        : {
            updatedAt: startedAt,
            startedAt,
            endedAt: null,
            durationText: null,
            maxConcurrent: avg * 2,
            maxConcurrentAt: null,
            avgConcurrent: avg,
            watchTimeHours: 1,
            views: options.views ?? 1000,
            likes: options.likes ?? 100,
          },
    chat: {
      total: chat,
      byKind: {
        text: chat - scCount,
        superchat: scCount,
        sticker: 0,
        membership: 0,
      },
      pureEmojiOnly: 0,
      uniqueAuthors: 10,
      ownerMessages: 0,
      badges: { Member: chat },
      timeRange: { firstAt: startedAt, lastAt: startedAt, preRollSec: 0 },
      coveragePct: 100,
      density: {
        perMinuteMean: 1,
        peakMinute: { offsetMin: peakOffset, at: startedAt, count: 100 },
        perMinute,
        perMinuteSc: Array.from({ length: minutes }, () => 0),
        perFiveMinute: [],
        perTenMinute: [],
      },
      paid: {
        superchats: options.sc
          ? [
              {
                at: startedAt,
                author: "tester",
                amountText: `${options.sc.currency} ${options.sc.amount}`,
                currency: options.sc.currency,
                amount: options.sc.amount,
                message: "",
              },
            ]
          : [],
        scTotalsByCurrency: options.sc
          ? { [options.sc.currency]: { count: options.sc.count, amount: options.sc.amount } }
          : {},
        stickers: [],
        stickerTotalsByCurrency: {},
        memberships: [],
        paidSharePct: 0,
      },
      topAuthors: options.authors ?? [],
      topWords: options.words ?? [],
      hashtags: {},
      emojiKinds: { distinct: 0, top: [] },
    },
    comments:
      options.comments == null
        ? null
        : {
            total: options.comments,
            topLevel: options.comments,
            replies: 0,
            pinned: 0,
            totalLikes: 0,
            items: [],
          },
    derived: {
      chatPer1000AvgViewers: avg ? (chat / avg) * 1000 : null,
      likesPer1000Views: null,
      scPerHour: null,
      vstatsVsYtdlpViews: null,
    },
  };
}

describe("aggregate", () => {
  const rows = [
    {
      summary: makeSummary({
        videoId: "a",
        startedAt: "2026-10-01T20:00:00+09:00",
        durationSec: 3600,
        chatTotal: 100,
      }),
      pack: makePack({
        id: "a",
        startedAt: "2026-10-01T20:00:00+09:00",
        durationSec: 3600,
        avg: 100,
        chat: 100,
        sc: { currency: "¥", amount: 500, count: 2 },
        words: [{ word: "ライブ", count: 5 }],
        authors: [
          {
            author: "@a",
            messages: 10,
            superchats: 1,
            stickers: 0,
            memberships: 0,
            badges: ["Member"],
          },
        ],
        peakOffset: 5,
      }),
    },
    {
      summary: makeSummary({
        videoId: "b",
        startedAt: "2026-10-02T20:00:00+09:00",
        durationSec: 3600,
        chatTotal: 50,
      }),
      pack: makePack({
        id: "b",
        startedAt: "2026-10-02T20:00:00+09:00",
        durationSec: 3600,
        avg: 200,
        chat: 50,
        sc: { currency: "₩", amount: 1000, count: 1 },
        words: [{ word: "ライブ", count: 3 }],
        peakOffset: 7,
        comments: 4,
      }),
    },
  ];

  it("builds rows sorted by start time descending", () => {
    const built = buildStreamRows(
      { streams: rows.map(row => row.summary) },
      new Map(rows.map(row => [row.summary.videoId, row.pack])),
    );
    expect(built.map(row => row.summary.videoId)).toEqual(["b", "a"]);
    expect(findStreamRow(built, "a")?.pack.video.id).toBe("a");
    expect(findStreamRow(built, "missing")).toBeNull();
  });

  it("builds summary rows without packs", () => {
    const built = buildSummaryRows({ streams: rows.map(row => row.summary) });
    expect(built.map(row => row.videoId)).toEqual(["b", "a"]);
    expect(findStreamSummary(built, "a")?.title).toBe("stream a");
    expect(findStreamSummary(built, "missing")).toBeNull();
    expect(findStreamSummary(built, null)).toBeNull();
  });

  it("aggregates totals, currencies, words and best streams", () => {
    const totals = aggregateDataset(rows);
    expect(totals.streamCount).toBe(2);
    expect(totals.chatTotal).toBe(150);
    expect(totals.chatByKind.superchat).toBe(3);
    expect(totals.views).toBe(2000);
    expect(totals.withVstatsCount).toBe(2);
    expect(totals.commentTotal).toBe(4);
    expect(totals.scByCurrency).toEqual([
      { currency: "₩", count: 1, amount: 1000 },
      { currency: "¥", count: 2, amount: 500 },
    ]);
    expect(totals.topWords[0]).toMatchObject({ word: "ライブ", count: 8, streams: 2 });
    expect(totals.topAuthors[0]).toMatchObject({ author: "@a", messages: 10, streams: 1 });
    expect(totals.bestByAvg?.videoId).toBe("b");
    expect(totals.bestByChat?.videoId).toBe("a");
    expect(totals.bestBySc?.videoId).toBe("a");
    expect(totals.peakChatMinute).toMatchObject({
      videoId: "a",
      value: 100,
      offsetMin: 5,
    });
  });

  it("sorts currency rows by amount", () => {
    expect(
      currencyRows({
        "¥": { count: 1, amount: 10 },
        "₩": { count: 1, amount: 20 },
      }),
    ).toEqual([
      { currency: "₩", count: 1, amount: 20 },
      { currency: "¥", count: 1, amount: 10 },
    ]);
  });

  it("builds a relative stream shape aligned by progress", () => {
    const a = makePack({
      id: "a",
      startedAt: "2026-10-01T20:00:00+09:00",
      durationSec: 240,
      avg: null,
      chat: 40,
    });
    const b = makePack({
      id: "b",
      startedAt: "2026-10-02T20:00:00+09:00",
      durationSec: 240,
      avg: null,
      chat: 80,
    });
    a.chat.density.perMinute = [10, 10, 10, 10];
    b.chat.density.perMinute = [40, 0, 0, 40];

    const shape = buildStreamShape([{ pack: a }, { pack: b }], 4);
    expect(shape?.bucketCount).toBe(4);
    expect(shape?.streams).toBe(2);
    expect(shape?.buckets.map(bucket => bucket.relative)).toEqual([1.5, 0.5, 0.5, 1.5]);
    expect(shape?.buckets[0]?.perMinute).toBe(25);
    expect(shape?.headRelative).toBe(1.5);
    expect(shape?.midRelative).toBe(0.5);
    expect(shape?.tailRelative).toBe(1.5);
    expect(shape?.peak).toEqual({ position: 0.125, relative: 1.5 });
  });

  it("returns null when no stream has minute density", () => {
    const pack = makePack({
      id: "empty",
      startedAt: "2026-10-01T20:00:00+09:00",
      durationSec: 240,
      avg: null,
      chat: 0,
    });
    pack.chat.density.perMinute = [];

    expect(buildStreamShape([{ pack }])).toBeNull();
  });
});

describe("buildMonthlySeries", () => {
  it("groups rows by calendar month in ascending order", () => {
    const rows = [
      makeSummary({ startedAt: "2026-09-12T20:00:00+09:00", videoId: "a", durationSec: 600, chatTotal: 60, superchats: 1, uniqueAuthors: 10 }),
      makeSummary({ startedAt: "2026-09-20T20:00:00+09:00", videoId: "b", durationSec: 600, chatTotal: 120, superchats: 2, uniqueAuthors: 20 }),
      makeSummary({ startedAt: "2026-10-02T20:00:00+09:00", videoId: "c", durationSec: 1200, chatTotal: 240 }),
    ];

    const series = buildMonthlySeries(rows);
    expect(series.map(point => point.month)).toEqual(["2026-09", "2026-10"]);
    expect(series[0]).toMatchObject({
      label: "9 月",
      streams: 2,
      chatTotal: 180,
      superchats: 3,
      chatPerMinute: 9,
      avgAuthors: 15,
    });
    expect(series[1]).toMatchObject({
      label: "10 月",
      streams: 1,
      chatPerMinute: 12,
      avgAuthors: null,
    });
  });

  it("keeps only the most recent months", () => {
    const rows = ["2026-05", "2026-06", "2026-07"].map((month, index) =>
      makeSummary({
        startedAt: `${month}-01T20:00:00+09:00`,
        videoId: `v${index}`,
        durationSec: 60,
      }),
    );
    expect(buildMonthlySeries(rows, 2).map(point => point.month)).toEqual([
      "2026-06",
      "2026-07",
    ]);
  });

  it("skips rows without a usable start date", () => {
    const rows = [makeSummary({ startedAt: null, videoId: "a", durationSec: 60 })];
    expect(buildMonthlySeries(rows)).toEqual([]);
  });
});

describe("buildCalendarDays", () => {
  it("merges streams on the same JST date", () => {
    const rows = [
      makeSummary({
        startedAt: "2026-10-01T20:00:00+09:00",
        videoId: "a",
        durationSec: 600,
        chatTotal: 100,
        superchats: 2,
      }),
      makeSummary({
        startedAt: "2026-10-01T23:00:00+09:00",
        videoId: "b",
        durationSec: 1200,
        chatTotal: 50,
        superchats: 1,
      }),
      makeSummary({
        startedAt: "2026-10-03T20:00:00+09:00",
        videoId: "c",
        durationSec: 600,
        chatTotal: 30,
      }),
    ];

    const days = buildCalendarDays(rows);
    expect(days.map(day => day.date)).toEqual(["2026-10-01", "2026-10-03"]);
    expect(days[0]).toEqual({
      date: "2026-10-01",
      streams: 2,
      chat: 150,
      superchats: 3,
      durationSec: 1800,
    });
    expect(calendarMetricValue(days[0]!, "streams")).toBe(2);
    expect(calendarMetricValue(days[0]!, "chat")).toBe(150);
    expect(calendarMetricValue(days[0]!, "superchats")).toBe(3);
  });

  it("falls back to startedAt when date is empty", () => {
    const rows = [
      makeSummary({
        startedAt: "2026-09-12T20:00:00+09:00",
        videoId: "a",
        durationSec: 60,
        date: "",
      }),
    ];
    expect(buildCalendarDays(rows).map(day => day.date)).toEqual(["2026-09-12"]);
  });

  it("skips rows without a usable date", () => {
    const rows = [makeSummary({ startedAt: null, videoId: "a", durationSec: 60, date: "" })];
    expect(buildCalendarDays(rows)).toEqual([]);
  });
});

describe("buildContentTypeStats", () => {
  it("aggregates duration, chat, SC and concurrent by title type", () => {
    const rows = [
      makeSummary({
        videoId: "a",
        startedAt: "2026-10-01T20:00:00+09:00",
        durationSec: 3600,
        chatTotal: 120,
        superchats: 2,
        commentsCaptured: 10,
        avgConcurrent: 100,
        title: "【弾き語り】アコギ練習",
      }),
      makeSummary({
        videoId: "b",
        startedAt: "2026-10-02T20:00:00+09:00",
        durationSec: 1800,
        chatTotal: 60,
        superchats: 1,
        commentsCaptured: 4,
        avgConcurrent: null,
        title: "【弾き語り】夜の歌枠",
      }),
      makeSummary({
        videoId: "c",
        startedAt: "2026-10-03T20:00:00+09:00",
        durationSec: 7200,
        chatTotal: 240,
        superchats: 3,
        commentsCaptured: null,
        avgConcurrent: 200,
        title: "【ゲーム】魔女裁判",
      }),
      makeSummary({
        videoId: "d",
        startedAt: "2026-10-04T20:00:00+09:00",
        durationSec: 1800,
        chatTotal: 30,
        superchats: 0,
        commentsCaptured: 2,
        avgConcurrent: null,
        title: "【おしゃべり】ふつおた",
      }),
      makeSummary({
        videoId: "e",
        startedAt: "2026-10-05T20:00:00+09:00",
        durationSec: 600,
        chatTotal: 10,
        title: "未分类标题",
      }),
    ];

    const stats = buildContentTypeStats(rows);
    const sing = stats.find(stat => stat.key === "sing");
    const game = stats.find(stat => stat.key === "game");
    const talk = stats.find(stat => stat.key === "talk");

    expect(sing).toMatchObject({
      streams: 2,
      share: 0.4,
      durationSec: 5400,
      avgDurationSec: 2700,
      chatTotal: 180,
      superchats: 3,
      commentsCaptured: 14,
      commentsPerStream: 7,
      chatPerMinute: 2,
      scPerHour: 2,
      avgConcurrent: 100,
      concurrentStreams: 1,
    });
    expect(game).toMatchObject({ streams: 1, chatPerMinute: 2, scPerHour: 1.5 });
    expect(talk).toMatchObject({ streams: 2, chatTotal: 40, commentsPerStream: 1 });
    expect(stats.map(stat => stat.label)).toEqual(["弹唱", "活动", "杂谈", "游戏"]);
  });

  it("returns zeroed rows for an empty dataset", () => {
    const stats = buildContentTypeStats([]);
    expect(stats).toHaveLength(4);
    expect(stats.every(stat => stat.streams === 0 && stat.share === 0)).toBe(true);
    expect(stats.every(stat => stat.chatPerMinute === null)).toBe(true);
  });
});

describe("percentChange", () => {
  it("computes relative change", () => {
    expect(percentChange(130, 100)).toBeCloseTo(30);
    expect(percentChange(50, 100)).toBeCloseTo(-50);
  });

  it("returns null when a value is missing or the base is zero", () => {
    expect(percentChange(null, 100)).toBeNull();
    expect(percentChange(100, 0)).toBeNull();
    expect(percentChange(100, null)).toBeNull();
  });
});
