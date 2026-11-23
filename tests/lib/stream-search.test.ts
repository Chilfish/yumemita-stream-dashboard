import { describe, expect, it } from "vitest";
import {
  parseStreamSearchParams,
  STREAM_SEARCH_DEFAULT_LIMIT,
  STREAM_SEARCH_MAX_LIMIT,
  toStreamSearchItem,
} from "@/lib/stream-search";
import type { StreamSummary } from "@/types/dataset";

function parse(query: string) {
  return parseStreamSearchParams(new URLSearchParams(query));
}

describe("parseStreamSearchParams", () => {
  it("默认值：全员、全部类型、按日期倒序、50 条", () => {
    const { params, error } = parse("");
    expect(error).toBeNull();
    expect(params).toEqual({
      q: "",
      members: [],
      type: "all",
      from: null,
      to: null,
      availability: "all",
      sort: "date",
      dir: "desc",
      limit: STREAM_SEARCH_DEFAULT_LIMIT,
      offset: 0,
    });
  });

  it("member 支持重复与逗号分隔，并去重", () => {
    const { params } = parse("member=arale,nonoka&member=arale&members=yuno");
    expect(params.members).toEqual(["arale", "nonoka", "yuno"]);
  });

  it("q 会去掉首尾空白", () => {
    expect(parse("q=%20%E6%AD%8C%E6%9E%A0%20").params.q).toBe("歌枠");
  });

  it("枚举与日期参数非法时带字段名报错", () => {
    expect(parse("type=sleep").error).toContain("type");
    expect(parse("sort=rank").error).toContain("sort");
    expect(parse("dir=up").error).toContain("dir");
    expect(parse("availability=locked").error).toContain("availability");
    expect(parse("from=2026-02-30").error).toContain("from");
    expect(parse("to=20261123").error).toContain("to");
    expect(parse("member=bad id").error).toContain("member");
  });

  it("from 晚于 to 时报错", () => {
    expect(parse("from=2026-11-20&to=2026-11-01").error).toContain("from");
  });

  it("limit / offset 校验范围", () => {
    expect(parse(`limit=${STREAM_SEARCH_MAX_LIMIT}`).params.limit).toBe(STREAM_SEARCH_MAX_LIMIT);
    expect(parse("limit=0").error).toContain("limit");
    expect(parse(`limit=${STREAM_SEARCH_MAX_LIMIT + 1}`).error).toContain("limit");
    expect(parse("limit=ten").error).toContain("limit");
    expect(parse("offset=-1").error).toContain("offset");
  });

  it("q 过长时报错", () => {
    expect(parse(`q=${"あ".repeat(121)}`).error).toContain("q");
  });

  it("合法组合原样保留", () => {
    const { params, error } = parse(
      "q=歌枠&member=arale&type=sing&from=2026-01-01&to=2026-12-31&availability=public&sort=views&dir=asc&limit=20&offset=40",
    );
    expect(error).toBeNull();
    expect(params).toMatchObject({
      q: "歌枠",
      members: ["arale"],
      type: "sing",
      from: "2026-01-01",
      to: "2026-12-31",
      availability: "public",
      sort: "views",
      dir: "asc",
      limit: 20,
      offset: 40,
    });
  });
});

describe("toStreamSearchItem", () => {
  const summary = {
    datasetId: "arale",
    videoId: "vid1",
    title: "【歌枠】ののうた",
  } as unknown as StreamSummary & { datasetId: string };

  it("补内容类型与三种后续链接", () => {
    const item = toStreamSearchItem(summary, "https://example.com/");
    expect(item.type).toBe("sing");
    expect(item.links).toEqual({
      html: "https://example.com/arale/stream/vid1",
      markdown: "https://example.com/arale/stream/vid1.md",
      pack: "https://example.com/api/packs/arale/vid1",
    });
  });
});
