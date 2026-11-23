import { describe, expect, it } from "vitest";
import { SCHEMAS } from "@/lib/json-schema";

type JsonSchema = Record<string, unknown>;

/** 够用的 draft-07 子集：type / enum / required / properties / additionalProperties / $ref / oneOf / items。 */
function resolve(schema: JsonSchema, root: JsonSchema): JsonSchema {
  const target = schema.$ref;
  if (typeof target !== "string") return schema;
  const name = target.replace("#/$defs/", "");
  const defs = (root.$defs ?? {}) as Record<string, JsonSchema>;
  const found = defs[name];
  if (!found) throw new Error(`未定义的 $ref: ${target}`);
  return found;
}

function validate(value: unknown, schema: JsonSchema, root: JsonSchema, path = "$"): string[] {
  const resolved = resolve(schema, root);

  if (Array.isArray(resolved.oneOf)) {
    const results = (resolved.oneOf as JsonSchema[]).map(item =>
      validate(value, item, root, path),
    );
    if (results.some(errors => errors.length === 0)) return [];
    return [`${path}: 不匹配任何一个 oneOf 分支`];
  }

  const errors: string[] = [];

  if (resolved.type !== undefined) {
    const types = Array.isArray(resolved.type) ? (resolved.type as string[]) : [resolved.type as string];
    const matches = types.some(type => {
      if (type === "null") return value === null;
      if (type === "array") return Array.isArray(value);
      if (type === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
      if (type === "number") return typeof value === "number";
      if (type === "string") return typeof value === "string";
      if (type === "boolean") return typeof value === "boolean";
      if (type === "integer") return Number.isInteger(value);
      throw new Error(`未知 type: ${type}`);
    });
    if (!matches) return [`${path}: 期望 ${types.join(" | ")}，实际 ${JSON.stringify(value)}`];
  }

  if (Array.isArray(resolved.enum) && !(resolved.enum as unknown[]).includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} 不在枚举 ${JSON.stringify(resolved.enum)} 内`);
  }

  if (Array.isArray(value)) {
    const items = resolved.items as JsonSchema | undefined;
    if (items) {
      value.forEach((entry, index) => {
        errors.push(...validate(entry, items, root, `${path}[${index}]`));
      });
    }
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const properties = (resolved.properties ?? {}) as Record<string, JsonSchema>;
    const required = (resolved.required ?? []) as string[];

    for (const key of required) {
      if (!(key in record)) errors.push(`${path}.${key}: 缺少必填字段`);
    }

    for (const [key, entry] of Object.entries(record)) {
      if (properties[key]) {
        errors.push(...validate(entry, properties[key], root, `${path}.${key}`));
        continue;
      }
      if (resolved.additionalProperties === false) {
        errors.push(`${path}.${key}: schema 未声明这个字段`);
        continue;
      }
      if (typeof resolved.additionalProperties === "object" && resolved.additionalProperties !== null) {
        errors.push(
          ...validate(entry, resolved.additionalProperties as JsonSchema, root, `${path}.${key}`),
        );
      }
    }
  }

  return errors;
}

const datapack = SCHEMAS["stream-datapack.v2"].schema;
const transcript = SCHEMAS["transcript.v1"].schema;
const densities = SCHEMAS["densities.v1"].schema;
const streamSearch = SCHEMAS["stream-search.v1"].schema;

/** 与 `/api/packs` 的实际输出同形：v2 全量字段齐全。 */
function pack(): Record<string, unknown> {
  return {
    schema: "yumemita.stream-datapack/v2",
    generatedAt: "2026-11-14T12:00:00.000Z",
    video: {
      id: "vid1",
      url: "https://www.youtube.com/watch?v=vid1",
      title: "歌枠",
      channelId: "UC1",
      channelName: "仲町あられ",
      channelUrl: null,
      channelFollowersAtCapture: 120000,
      liveStatus: "past",
      availability: "public",
      startedAt: "2026-11-14T11:00:00.000Z",
      publishedAt: null,
      durationSec: 3600,
      durationHms: "1:00:00",
      endedAt: null,
      thumbnail: "thumbs/vid1.jpg",
      description: null,
      links: [],
      chapters: [],
      hasLiveChatReplay: true,
      captionsJa: false,
      snapshot: { views: 1000, likes: 100, comments: 20 },
    },
    vstats: null,
    chat: {
      total: 100,
      byKind: { text: 80, superchat: 10, sticker: 5, membership: 5 },
      pureEmojiOnly: 3,
      uniqueAuthors: 40,
      ownerMessages: 2,
      badges: { Member: 10 },
      timeRange: { firstAt: null, lastAt: null, preRollSec: 30 },
      coveragePct: 99.5,
      density: {
        perMinuteMean: 1.5,
        peakMinute: { offsetMin: 10, at: "11:10", count: 30 },
        perMinute: [1, 2, 3],
        perMinuteSc: [0, 0, 1],
        perFiveMinute: [5, 6],
        perTenMinute: [{ offsetMin: 0, at: "11:00", messages: 5, superchats: 1 }],
      },
      paid: {
        superchats: [
          {
            at: "11:10",
            author: "a",
            amountText: "¥500",
            currency: "¥",
            amount: 500,
            message: "hi",
            emojis: ["UC1/hash"],
          },
        ],
        scTotalsByCurrency: { "¥": { count: 1, amount: 500 } },
        stickers: [{ at: "11:11", author: "b", amountText: "¥200", currency: "¥", amount: 200 }],
        stickerTotalsByCurrency: { "¥": { count: 1, amount: 200 } },
        memberships: [{ at: "11:12", author: "c", header: "Welcome" }],
        gifts: [{ at: "11:13", author: "d", count: 5, text: "Sent 5 gifts" }],
        paidSharePct: 12.5,
      },
      topAuthors: [
        {
          author: "a",
          authorId: "UCa",
          messages: 10,
          superchats: 1,
          stickers: 0,
          memberships: 0,
          badges: ["Member"],
        },
      ],
      topWords: [{ word: "歌", count: 12 }],
      authors: [
        { author: "a", authorId: "UCa", messages: 10, superchats: 1, stickers: 0, memberships: 0 },
      ],
      wordCounts: { 歌: 12 },
      hashtags: { 歌枠: 3 },
      emojiKinds: { distinct: 2, top: [{ id: "UC1/hash", count: 4 }] },
      emojis: [{ id: "UC1/hash", name: "hi", url: "https://example.com/e.png" }],
      ownerChats: [{ at: "11:00", kind: "text", text: "こんにちは", emojis: [] }],
      memberChats: [
        {
          at: "11:01",
          memberId: "yuno",
          memberLabel: "千石ユノ",
          author: "@yuno_yumemita",
          authorId: "UCyuno",
          kind: "text",
          text: "うわ…",
          emojis: ["UC1/hash"],
        },
      ],
      events: [
        { at: "11:05", type: "poll", owner: true, text: null, data: { options: [] } },
      ],
    },
    comments: {
      total: 20,
      topLevel: 18,
      replies: 0,
      pinned: 1,
      totalLikes: 300,
      items: [
        {
          author: "e",
          authorId: "UCe",
          likes: 5,
          at: "2026-11-14T12:00:00.000Z",
          pinned: false,
          byUploader: false,
          text: "good",
        },
      ],
    },
    derived: {
      chatPer1000AvgViewers: 12.5,
      likesPer1000Views: 100,
      scPerHour: 10,
      vstatsVsYtdlpViews: null,
    },
  };
}

describe("JSON Schema 与真实响应同形", () => {
  it("v2 datapack 通过校验", () => {
    expect(validate(pack(), datapack, datapack)).toEqual([]);
  });

  it("v1 datapack 也能通过（v2 新增字段都是可选）", () => {
    const legacy = pack();
    legacy.schema = "yumemita.stream-datapack/v1";
    const chat = legacy.chat as Record<string, unknown>;
    delete chat.authors;
    delete chat.wordCounts;
    delete chat.emojis;
    delete chat.ownerChats;
    delete chat.memberChats;
    delete chat.events;
    const paid = chat.paid as Record<string, unknown>;
    delete paid.gifts;
    const topAuthors = chat.topAuthors as Record<string, unknown>[];
    delete topAuthors[0].authorId;

    expect(validate(legacy, datapack, datapack)).toEqual([]);
  });

  it("缺必填字段与多余字段都会报错", () => {
    const missing = pack();
    delete missing.derived;
    expect(validate(missing, datapack, datapack).join()).toContain("缺少必填字段");

    const extra = pack();
    extra.unexpected = true;
    expect(validate(extra, datapack, datapack).join()).toContain("schema 未声明这个字段");
  });

  it("类型不符会报错", () => {
    const wrong = pack();
    (wrong.chat as Record<string, unknown>).total = "100";
    expect(validate(wrong, datapack, datapack).join()).toContain("期望 number");
  });

  it("transcript 通过校验", () => {
    const payload = {
      schema: "yumemita.transcript/v1",
      datasetId: "nonoka",
      videoId: "vid1",
      frontmatter: {
        videoId: "vid1",
        date: "2026-10-13",
        title: "标题",
        members: ["nonoka"],
        tags: ["杂谈"],
        membersOnly: false,
        summary: null,
        tweets: [],
      },
      markdown: "## 开场\n",
      updatedAt: "2026-10-29T22:55:00.000Z",
    };
    expect(validate(payload, transcript, transcript)).toEqual([]);
  });

  it("densities 通过校验", () => {
    const payload = { densities: { vid1: [1, 2, 3] }, locked: ["vid2"] };
    expect(validate(payload, densities, densities)).toEqual([]);
  });

  it("stream-search 通过校验", () => {
    const payload = {
      schema: "yumemita.stream-search/v1",
      query: {
        q: "",
        members: [],
        type: "all",
        from: null,
        to: null,
        availability: "all",
        sort: "date",
        dir: "desc",
        limit: 50,
        offset: 0,
      },
      total: 1,
      count: 1,
      nextOffset: null,
      streams: [
        {
          rank: 1,
          datasetId: "arale",
          participants: [],
          date: "2026-11-14",
          videoId: "vid1",
          title: "歌枠",
          url: "https://www.youtube.com/watch?v=vid1",
          durationHms: "1:00:00",
          durationSec: 3600,
          startedAt: "2026-11-14T11:00:00.000Z",
          endedAt: null,
          availability: "public",
          avgConcurrent: 1.5,
          maxConcurrent: 2,
          maxConcurrentAt: "11:30",
          watchTimeHours: 1.5,
          vstatsViews: 100,
          vstatsLikes: 10,
          snapshotViews: 90,
          snapshotLikes: 9,
          snapshotComments: 3,
          chatTotal: 50,
          chatByKind: { text: 50 },
          pureEmojiOnly: 0,
          uniqueAuthors: 20,
          superchats: 0,
          scTotalsByCurrency: {},
          stickers: 0,
          memberships: 0,
          commentsCaptured: 3,
          chatPer1000AvgViewers: null,
          likesPer1000Views: null,
          scPerHour: null,
          sessionDir: "",
          datapack: "",
          generatedAt: "2026-11-14T12:00:00.000Z",
          type: "sing",
          links: {
            html: "https://example.com/arale/stream/vid1",
            markdown: "https://example.com/arale/stream/vid1.md",
            pack: "https://example.com/api/packs/arale/vid1",
          },
        },
      ],
    };
    expect(validate(payload, streamSearch, streamSearch)).toEqual([]);
  });

  it("每个 $defs 都被引用且能被解析", () => {
    const defs = (datapack.$defs ?? {}) as Record<string, JsonSchema>;
    expect(Object.keys(defs).length).toBeGreaterThan(20);
    // record() 里的 additionalProperties 用 $ref 时也要能解析到。
    for (const def of Object.values(defs)) {
      const text = JSON.stringify(def);
      for (const match of text.matchAll(/#\/\$defs\/([\w]+)/g)) {
        if (!defs[match[1]]) throw new Error(`未定义的 $ref: ${match[1]}`);
      }
    }
  });
});
