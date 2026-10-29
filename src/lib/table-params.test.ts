import { describe, expect, it } from "vitest";
import {
  DEFAULT_TABLE_PARAMS,
  OPTIONAL_TABLE_COLUMNS,
  STREAM_TYPE_FILTERS,
  TABLE_SORT_KEYS,
  isOptionalTableColumn,
  isSortDirection,
  isStreamTypeFilter,
  isTableSortKey,
  parseTableParams,
  sameColumnSet,
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
      type: "all",
      sort: "date",
      dir: "desc",
      vstats: false,
      member: false,
      cols: [],
    });
    expect(parseTableParams(search(""))).toEqual(DEFAULT_TABLE_PARAMS);
  });

  it("reads every supported param", () => {
    const params = parseTableParams(
      search("q=abc&type=event&sort=chat&dir=asc&vstats=1&member=1&cols=avg,type"),
    );
    expect(params).toEqual({
      q: "abc",
      type: "event",
      sort: "chat",
      dir: "asc",
      vstats: true,
      member: true,
      cols: ["type", "avg"],
    });
  });

  it("keeps only known optional columns, deduped and in canonical order", () => {
    expect(parseTableParams(search("cols=avg,avg,nope,likeRate")).cols).toEqual([
      "avg",
      "likeRate",
    ]);
    expect(parseTableParams(search("cols=")).cols).toEqual([]);
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

  it("reads every content type filter", () => {
    for (const type of STREAM_TYPE_FILTERS) {
      expect(parseTableParams(search(`type=${type}`)).type).toBe(type);
    }
  });

  it("falls back to all for unknown or empty type values", () => {
    expect(parseTableParams(search("type=nope")).type).toBe("all");
    expect(parseTableParams(search("type=")).type).toBe("all");
    expect(parseTableParams(search("type=SING")).type).toBe("all");
    expect(parseTableParams(search("")).type).toBe("all");
  });

  it("accepts 1 and true for vstats and rejects everything else", () => {
    expect(parseTableParams(search("vstats=1")).vstats).toBe(true);
    expect(parseTableParams(search("vstats=true")).vstats).toBe(true);
    expect(parseTableParams(search("vstats=0")).vstats).toBe(false);
    expect(parseTableParams(search("vstats=false")).vstats).toBe(false);
    expect(parseTableParams(search("vstats=yes")).vstats).toBe(false);
  });

  it("accepts 1 and true for member and rejects everything else", () => {
    expect(parseTableParams(search("member=1")).member).toBe(true);
    expect(parseTableParams(search("member=true")).member).toBe(true);
    expect(parseTableParams(search("member=0")).member).toBe(false);
    expect(parseTableParams(search("member=false")).member).toBe(false);
    expect(parseTableParams(search("member=yes")).member).toBe(false);
  });

  it("uses the first value for duplicated params", () => {
    expect(parseTableParams(search("dir=asc&dir=desc")).dir).toBe("asc");
    expect(parseTableParams(search("type=game&type=sing")).type).toBe("game");
  });
});

describe("writeTableParams", () => {
  it("omits every param at the defaults", () => {
    expect(writeTableParams(search(""), DEFAULT_TABLE_PARAMS).toString()).toBe("");
  });

  it("removes defaults from an existing search string", () => {
    const next = writeTableParams(
      search("q=abc&type=sing&sort=chat&dir=asc&vstats=1&member=1"),
      DEFAULT_TABLE_PARAMS,
    );
    expect(next.toString()).toBe("");
    expect(next.has("type")).toBe(false);
  });

  it("writes non-default params", () => {
    const next = writeTableParams(search(""), {
      q: "直播",
      type: "talk",
      sort: "likes",
      dir: "asc",
      vstats: true,
      member: true,
      cols: [],
    });
    expect(next.get("q")).toBe("直播");
    expect(next.get("type")).toBe("talk");
    expect(next.get("sort")).toBe("likes");
    expect(next.get("dir")).toBe("asc");
    expect(next.get("vstats")).toBe("1");
    expect(next.get("member")).toBe("1");
  });

  it("writes asc explicitly because desc is the default", () => {
    const next = writeTableParams(search(""), { ...DEFAULT_TABLE_PARAMS, dir: "asc" });
    expect(next.toString()).toBe("dir=asc");
  });

  it("omits the type param when the filter is all", () => {
    const next = writeTableParams(search("type=game"), { ...DEFAULT_TABLE_PARAMS, type: "all" });
    expect(next.has("type")).toBe(false);
    expect(next.toString()).not.toContain("type");
  });

  it("never emits vstats=0", () => {
    const next = writeTableParams(search("vstats=1"), { ...DEFAULT_TABLE_PARAMS, vstats: false });
    expect(next.has("vstats")).toBe(false);
    expect(next.toString()).not.toContain("vstats");
  });

  it("never emits member=0", () => {
    const next = writeTableParams(search("member=1"), { ...DEFAULT_TABLE_PARAMS, member: false });
    expect(next.has("member")).toBe(false);
    expect(next.toString()).not.toContain("member");
  });

  it("writes optional columns in canonical order and drops them when empty", () => {
    const next = writeTableParams(search(""), {
      ...DEFAULT_TABLE_PARAMS,
      cols: ["likeRate", "avg"],
    });
    expect(next.get("cols")).toBe("avg,likeRate");

    const cleared = writeTableParams(next, { ...DEFAULT_TABLE_PARAMS, cols: [] });
    expect(cleared.has("cols")).toBe(false);
  });

  it("drops whitespace-only queries", () => {
    const next = writeTableParams(search(""), { ...DEFAULT_TABLE_PARAMS, q: "   " });
    expect(next.has("q")).toBe(false);
  });

  it("preserves unrelated params", () => {
    const next = writeTableParams(search("ids=a,b&ref=share"), {
      q: "abc",
      type: "sing",
      sort: "chat",
      dir: "desc",
      vstats: false,
      member: false,
      cols: [],
    });
    expect(next.get("ids")).toBe("a,b");
    expect(next.get("ref")).toBe("share");
    expect(next.get("q")).toBe("abc");
    expect(next.get("type")).toBe("sing");
    expect(next.get("sort")).toBe("chat");
    expect(next.has("dir")).toBe(false);
    expect(next.has("vstats")).toBe(false);
    expect(next.has("member")).toBe(false);
  });

  it("does not mutate the base search params", () => {
    const base = search("ids=a&q=old&type=game");
    writeTableParams(base, { ...DEFAULT_TABLE_PARAMS, q: "new", type: "event", vstats: true });
    expect(base.toString()).toBe("ids=a&q=old&type=game");
  });

  it("round-trips through parse", () => {
    const cases: TableParams[] = [
      DEFAULT_TABLE_PARAMS,
      { q: "abc", type: "all", sort: "chat", dir: "asc", vstats: true, member: false, cols: [] },
      {
        q: "直播 测试",
        type: "sing",
        sort: "comments",
        dir: "desc",
        vstats: false,
        member: true,
        cols: ["avg", "likeRate"],
      },
      { q: "", type: "game", sort: "sc", dir: "asc", vstats: true, member: false, cols: ["sc"] },
      { q: "活动", type: "event", sort: "date", dir: "desc", vstats: false, member: false, cols: [] },
      { q: "", type: "talk", sort: "authors", dir: "desc", vstats: false, member: true, cols: [] },
    ];

    for (const params of cases) {
      expect(parseTableParams(writeTableParams(search(""), params))).toEqual(params);
    }
  });

  it("round-trips the type filter without polluting the URL at the default", () => {
    const filtered = writeTableParams(search(""), { ...DEFAULT_TABLE_PARAMS, type: "talk" });
    expect(filtered.get("type")).toBe("talk");

    const cleared = writeTableParams(filtered, { ...DEFAULT_TABLE_PARAMS, type: "all" });
    expect(cleared.has("type")).toBe(false);
    expect(parseTableParams(cleared).type).toBe("all");
  });

  it("round-trips while keeping unrelated params", () => {
    const params: TableParams = {
      q: "abc",
      type: "event",
      sort: "watch",
      dir: "asc",
      vstats: true,
      member: true,
      cols: [],
    };
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

  it("accepts exactly the exported type filters", () => {
    expect([...STREAM_TYPE_FILTERS]).toEqual(["all", "sing", "event", "talk", "game"]);
    for (const type of STREAM_TYPE_FILTERS) {
      expect(isStreamTypeFilter(type)).toBe(true);
    }
    expect(isStreamTypeFilter("nope")).toBe(false);
    expect(isStreamTypeFilter("All")).toBe(false);
    expect(isStreamTypeFilter(null)).toBe(false);
    expect(isStreamTypeFilter(undefined)).toBe(false);
  });

  it("accepts exactly the optional column keys", () => {
    for (const key of OPTIONAL_TABLE_COLUMNS) {
      expect(isOptionalTableColumn(key)).toBe(true);
    }
    expect(isOptionalTableColumn("date")).toBe(false);
    expect(isOptionalTableColumn(null)).toBe(false);
    expect(isOptionalTableColumn(undefined)).toBe(false);
  });

  it("compares column sets regardless of order", () => {
    expect(sameColumnSet(["avg", "sc"], ["sc", "avg"])).toBe(true);
    expect(sameColumnSet(["avg"], ["avg", "sc"])).toBe(false);
    expect(sameColumnSet([], [])).toBe(true);
  });
});
