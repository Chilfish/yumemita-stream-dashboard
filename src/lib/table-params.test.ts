import { describe, expect, it } from "vitest";
import {
  DEFAULT_TABLE_PARAMS,
  TABLE_SORT_KEYS,
  isSortDirection,
  isTableSortKey,
  parseTableParams,
  type TableParams,
  writeTableParams,
} from "./table-params";

function search(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe("parseTableParams", () => {
  it("falls back to defaults when nothing is set", () => {
    expect(parseTableParams(search(""))).toEqual({
      q: "",
      sort: "date",
      dir: "desc",
      vstats: false,
    });
    expect(parseTableParams(search(""))).toEqual(DEFAULT_TABLE_PARAMS);
  });

  it("reads every supported param", () => {
    const params = parseTableParams(search("q=abc&sort=chat&dir=asc&vstats=1"));
    expect(params).toEqual({ q: "abc", sort: "chat", dir: "asc", vstats: true });
  });

  it("keeps the query as given and decodes url encoding", () => {
    expect(parseTableParams(search("q=a%20b%26c")).q).toBe("a b&c");
    expect(parseTableParams(search("q=%E7%9B%B4%E6%92%AD")).q).toBe("直播");
  });

  it("treats whitespace-only queries as empty", () => {
    expect(parseTableParams(search("q=%20%20%20")).q).toBe("");
    expect(parseTableParams(search("q=")).q).toBe("");
  });

  it("ignores invalid sort and dir values", () => {
    const params = parseTableParams(search("sort=nope&dir=sideways"));
    expect(params.sort).toBe("date");
    expect(params.dir).toBe("desc");
  });

  it("accepts 1 and true for vstats and rejects everything else", () => {
    expect(parseTableParams(search("vstats=1")).vstats).toBe(true);
    expect(parseTableParams(search("vstats=true")).vstats).toBe(true);
    expect(parseTableParams(search("vstats=0")).vstats).toBe(false);
    expect(parseTableParams(search("vstats=false")).vstats).toBe(false);
    expect(parseTableParams(search("vstats=yes")).vstats).toBe(false);
  });

  it("uses the first value for duplicated params", () => {
    expect(parseTableParams(search("dir=asc&dir=desc")).dir).toBe("asc");
  });
});

describe("writeTableParams", () => {
  it("omits every param at the defaults", () => {
    expect(writeTableParams(search(""), DEFAULT_TABLE_PARAMS).toString()).toBe("");
  });

  it("removes defaults from an existing search string", () => {
    const next = writeTableParams(
      search("q=abc&sort=chat&dir=asc&vstats=1"),
      DEFAULT_TABLE_PARAMS,
    );
    expect(next.toString()).toBe("");
  });

  it("writes non-default params", () => {
    const next = writeTableParams(search(""), {
      q: "直播",
      sort: "likes",
      dir: "asc",
      vstats: true,
    });
    expect(next.get("q")).toBe("直播");
    expect(next.get("sort")).toBe("likes");
    expect(next.get("dir")).toBe("asc");
    expect(next.get("vstats")).toBe("1");
  });

  it("writes asc explicitly because desc is the default", () => {
    const next = writeTableParams(search(""), { ...DEFAULT_TABLE_PARAMS, dir: "asc" });
    expect(next.toString()).toBe("dir=asc");
  });

  it("never emits vstats=0", () => {
    const next = writeTableParams(search("vstats=1"), { ...DEFAULT_TABLE_PARAMS, vstats: false });
    expect(next.has("vstats")).toBe(false);
    expect(next.toString()).not.toContain("vstats");
  });

  it("drops whitespace-only queries", () => {
    const next = writeTableParams(search(""), { ...DEFAULT_TABLE_PARAMS, q: "   " });
    expect(next.has("q")).toBe(false);
  });

  it("preserves unrelated params", () => {
    const next = writeTableParams(search("ids=a,b&ref=share"), {
      q: "abc",
      sort: "chat",
      dir: "desc",
      vstats: false,
    });
    expect(next.get("ids")).toBe("a,b");
    expect(next.get("ref")).toBe("share");
    expect(next.get("q")).toBe("abc");
    expect(next.get("sort")).toBe("chat");
    expect(next.has("dir")).toBe(false);
    expect(next.has("vstats")).toBe(false);
  });

  it("does not mutate the base search params", () => {
    const base = search("ids=a&q=old");
    writeTableParams(base, { ...DEFAULT_TABLE_PARAMS, q: "new", vstats: true });
    expect(base.toString()).toBe("ids=a&q=old");
  });

  it("round-trips through parse", () => {
    const cases: TableParams[] = [
      DEFAULT_TABLE_PARAMS,
      { q: "abc", sort: "chat", dir: "asc", vstats: true },
      { q: "直播 测试", sort: "comments", dir: "desc", vstats: false },
      { q: "", sort: "sc", dir: "asc", vstats: true },
    ];

    for (const params of cases) {
      expect(parseTableParams(writeTableParams(search(""), params))).toEqual(params);
    }
  });

  it("round-trips while keeping unrelated params", () => {
    const params: TableParams = { q: "abc", sort: "watch", dir: "asc", vstats: true };
    const written = writeTableParams(search("ids=x,y"), params);
    const parsed = parseTableParams(written);
    expect(parsed).toEqual(params);
    expect(written.get("ids")).toBe("x,y");
  });
});

describe("table param validation helpers", () => {
  it("accepts exactly the exported sort keys", () => {
    for (const key of TABLE_SORT_KEYS) {
      expect(isTableSortKey(key)).toBe(true);
    }
    expect(isTableSortKey("nope")).toBe(false);
    expect(isTableSortKey(null)).toBe(false);
    expect(isTableSortKey(undefined)).toBe(false);
  });

  it("accepts exactly asc and desc", () => {
    expect(isSortDirection("asc")).toBe(true);
    expect(isSortDirection("desc")).toBe(true);
    expect(isSortDirection("up")).toBe(false);
    expect(isSortDirection(null)).toBe(false);
  });
});
