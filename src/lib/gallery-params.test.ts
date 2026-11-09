import { describe, expect, it } from "vitest";
import {
  DEFAULT_GALLERY_PARAMS,
  GALLERY_ORDERS,
  GALLERY_TYPE_FILTERS,
  galleryDayLabel,
  galleryDayOf,
  isDefaultGalleryParams,
  isGalleryDay,
  isGalleryMemberId,
  isGalleryOrder,
  isGalleryTypeFilter,
  matchesGalleryDay,
  parseGalleryDay,
  parseGalleryMember,
  parseGalleryOrder,
  parseGalleryParams,
  parseGalleryType,
  writeGalleryOrder,
  writeGalleryParams,
  type GalleryParams,
} from "./gallery-params";

const MEMBER_IDS = ["nonoka", "nagi", "yura"];

function search(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe("parseGalleryParams", () => {
  it("falls back to defaults when nothing is set", () => {
    expect(parseGalleryParams(search(""), MEMBER_IDS)).toEqual({
      order: "desc",
      member: null,
      type: "all",
      day: null,
    });
    expect(parseGalleryParams(search(""), MEMBER_IDS)).toEqual(DEFAULT_GALLERY_PARAMS);
  });

  it("reads every supported param", () => {
    expect(
      parseGalleryParams(search("order=asc&member=nagi&type=sing&day=11-09"), MEMBER_IDS),
    ).toEqual({
      order: "asc",
      member: "nagi",
      type: "sing",
      day: "11-09",
    });
  });

  it("accepts leap-day and rejects impossible month-days", () => {
    expect(parseGalleryParams(search("day=02-29"), MEMBER_IDS).day).toBe("02-29");
    expect(parseGalleryParams(search("day=02-30"), MEMBER_IDS).day).toBeNull();
    expect(parseGalleryParams(search("day=13-01"), MEMBER_IDS).day).toBeNull();
    expect(parseGalleryParams(search("day=2026-11-09"), MEMBER_IDS).day).toBeNull();
    expect(parseGalleryParams(search("day="), MEMBER_IDS).day).toBeNull();
  });

  it("rejects member ids that are not in the dataset index", () => {
    expect(parseGalleryParams(search("member=ghost"), MEMBER_IDS).member).toBeNull();
    expect(parseGalleryParams(search("member=nonoka"), MEMBER_IDS).member).toBe("nonoka");
    expect(parseGalleryParams(search("member="), MEMBER_IDS).member).toBeNull();
    expect(parseGalleryParams(search("member=NONOKA"), MEMBER_IDS).member).toBeNull();
  });

  it("rejects member ids when the index is empty", () => {
    expect(parseGalleryParams(search("member=nonoka")).member).toBeNull();
  });

  it("reads every content type filter", () => {
    for (const type of GALLERY_TYPE_FILTERS) {
      expect(parseGalleryParams(search(`type=${type}`), MEMBER_IDS).type).toBe(type);
    }
  });

  it("falls back to all for unknown or empty type values", () => {
    expect(parseGalleryParams(search("type=nope"), MEMBER_IDS).type).toBe("all");
    expect(parseGalleryParams(search("type="), MEMBER_IDS).type).toBe("all");
    expect(parseGalleryParams(search("type=SING"), MEMBER_IDS).type).toBe("all");
  });

  it("falls back to desc for unknown order values", () => {
    expect(parseGalleryParams(search("order=sideways"), MEMBER_IDS).order).toBe("desc");
    expect(parseGalleryParams(search("order=ASC"), MEMBER_IDS).order).toBe("desc");
    expect(parseGalleryParams(search("order="), MEMBER_IDS).order).toBe("desc");
  });

  it("uses the first value for duplicated params", () => {
    const params = parseGalleryParams(
      search("order=asc&order=desc&member=nagi&member=yura&type=game&type=sing"),
      MEMBER_IDS,
    );
    expect(params).toEqual({ order: "asc", member: "nagi", type: "game", day: null });
  });

  it("keeps unrelated params out of the result", () => {
    expect(parseGalleryParams(search("ref=share&q=abc"), MEMBER_IDS)).toEqual(
      DEFAULT_GALLERY_PARAMS,
    );
  });
});

describe("parseGalleryParams single-value helpers", () => {
  it("parses order, type and member independently", () => {
    expect(parseGalleryOrder("asc")).toBe("asc");
    expect(parseGalleryOrder(null)).toBe("desc");
    expect(parseGalleryType("talk")).toBe("talk");
    expect(parseGalleryType(undefined)).toBe("all");
    expect(parseGalleryMember("yura", MEMBER_IDS)).toBe("yura");
    expect(parseGalleryMember("yura", [])).toBeNull();
    expect(parseGalleryMember(null, MEMBER_IDS)).toBeNull();
    expect(parseGalleryDay("11-09")).toBe("11-09");
    expect(parseGalleryDay("2-9")).toBeNull();
    expect(parseGalleryDay(undefined)).toBeNull();
  });

  it("formats and matches month-days", () => {
    expect(galleryDayLabel("05-20")).toBe("5 月 20 日");
    expect(galleryDayLabel("12-31")).toBe("12 月 31 日");
    expect(galleryDayOf("2026-11-09")).toBe("11-09");
    expect(galleryDayOf("2026-11-09T20:00:00+09:00")).toBeNull();
    expect(galleryDayOf("")).toBeNull();
    expect(matchesGalleryDay("2025-11-09", "11-09")).toBe(true);
    expect(matchesGalleryDay("2025-11-10", "11-09")).toBe(false);
    expect(matchesGalleryDay("2026-11-09", "11-09", "2026-11-09")).toBe(false);
    expect(matchesGalleryDay("2025-11-09", "11-09", "2026-11-09")).toBe(true);
    expect(matchesGalleryDay("2025-11-10", "11-09", "2026-11-09")).toBe(false);
    expect(matchesGalleryDay("2025-11-09", null)).toBe(true);
  });
});

describe("writeGalleryParams", () => {
  it("omits every param at the defaults", () => {
    expect(writeGalleryParams(search(""), DEFAULT_GALLERY_PARAMS).toString()).toBe("");
  });

  it("removes defaults from an existing search string", () => {
    const next = writeGalleryParams(
      search("order=asc&member=nagi&type=sing&day=11-09&ref=share"),
      DEFAULT_GALLERY_PARAMS,
    );
    expect(next.toString()).toBe("ref=share");
    expect(next.has("order")).toBe(false);
    expect(next.has("member")).toBe(false);
    expect(next.has("type")).toBe(false);
    expect(next.has("day")).toBe(false);
  });

  it("writes non-default params", () => {
    const next = writeGalleryParams(search(""), {
      order: "asc",
      member: "yura",
      type: "event",
      day: "11-09",
    });
    expect(next.get("order")).toBe("asc");
    expect(next.get("member")).toBe("yura");
    expect(next.get("type")).toBe("event");
    expect(next.get("day")).toBe("11-09");
  });

  it("never writes an invalid day", () => {
    const next = writeGalleryParams(search(""), {
      ...DEFAULT_GALLERY_PARAMS,
      day: "02-30",
    });
    expect(next.has("day")).toBe(false);
  });

  it("never writes an empty member", () => {
    const next = writeGalleryParams(search("member=nagi"), {
      ...DEFAULT_GALLERY_PARAMS,
      member: "",
    });
    expect(next.has("member")).toBe(false);
  });

  it("does not mutate the base search params", () => {
    const base = search("ref=share&member=nagi");
    writeGalleryParams(base, { order: "asc", member: "yura", type: "game", day: "11-09" });
    expect(base.toString()).toBe("ref=share&member=nagi");
  });

  it("round-trips through parse", () => {
    const cases: GalleryParams[] = [
      DEFAULT_GALLERY_PARAMS,
      { order: "asc", member: null, type: "all", day: null },
      { order: "desc", member: "nagi", type: "sing", day: null },
      { order: "asc", member: "yura", type: "game", day: "11-09" },
    ];

    for (const params of cases) {
      expect(parseGalleryParams(writeGalleryParams(search(""), params), MEMBER_IDS)).toEqual(params);
    }
  });

  it("round-trips while keeping unrelated params", () => {
    const params: GalleryParams = { order: "asc", member: "nonoka", type: "talk", day: "05-20" };
    const written = writeGalleryParams(search("ref=share"), params);
    expect(written.get("ref")).toBe("share");
    expect(parseGalleryParams(written, MEMBER_IDS)).toEqual(params);
  });
});

describe("writeGalleryOrder", () => {
  it("toggles the order without dropping filters", () => {
    const next = writeGalleryOrder(search("member=nagi&type=sing&day=11-09"), "asc");
    expect(next.get("order")).toBe("asc");
    expect(next.get("member")).toBe("nagi");
    expect(next.get("type")).toBe("sing");
    expect(next.get("day")).toBe("11-09");
  });

  it("drops the param when going back to the default", () => {
    const next = writeGalleryOrder(search("order=asc&member=nagi"), "desc");
    expect(next.has("order")).toBe(false);
    expect(next.get("member")).toBe("nagi");
  });

  it("does not mutate the base search params", () => {
    const base = search("order=asc");
    writeGalleryOrder(base, "desc");
    expect(base.get("order")).toBe("asc");
  });
});

describe("gallery param validation helpers", () => {
  it("accepts exactly the exported orders", () => {
    expect([...GALLERY_ORDERS]).toEqual(["desc", "asc"]);
    for (const order of GALLERY_ORDERS) expect(isGalleryOrder(order)).toBe(true);
    expect(isGalleryOrder("up")).toBe(false);
    expect(isGalleryOrder(null)).toBe(false);
    expect(isGalleryOrder(undefined)).toBe(false);
  });

  it("accepts exactly the exported type filters", () => {
    expect([...GALLERY_TYPE_FILTERS]).toEqual(["all", "sing", "event", "talk", "game"]);
    for (const type of GALLERY_TYPE_FILTERS) expect(isGalleryTypeFilter(type)).toBe(true);
    expect(isGalleryTypeFilter("nope")).toBe(false);
    expect(isGalleryTypeFilter("All")).toBe(false);
    expect(isGalleryTypeFilter(null)).toBe(false);
  });

  it("validates member ids against the dataset index", () => {
    expect(isGalleryMemberId("nagi", MEMBER_IDS)).toBe(true);
    expect(isGalleryMemberId("ghost", MEMBER_IDS)).toBe(false);
    expect(isGalleryMemberId("", MEMBER_IDS)).toBe(false);
    expect(isGalleryMemberId(null, MEMBER_IDS)).toBe(false);
    expect(isGalleryMemberId(undefined, MEMBER_IDS)).toBe(false);
  });

  it("validates month-day params", () => {
    expect(isGalleryDay("01-01")).toBe(true);
    expect(isGalleryDay("02-29")).toBe(true);
    expect(isGalleryDay("12-31")).toBe(true);
    expect(isGalleryDay("00-10")).toBe(false);
    expect(isGalleryDay("04-31")).toBe(false);
    expect(isGalleryDay("11-9")).toBe(false);
    expect(isGalleryDay(null)).toBe(false);
  });

  it("detects the default parameter set", () => {
    expect(isDefaultGalleryParams(DEFAULT_GALLERY_PARAMS)).toBe(true);
    expect(isDefaultGalleryParams({ order: "asc", member: null, type: "all", day: null })).toBe(
      false,
    );
    expect(isDefaultGalleryParams({ order: "desc", member: "nagi", type: "all", day: null })).toBe(
      false,
    );
    expect(isDefaultGalleryParams({ order: "desc", member: null, type: "sing", day: null })).toBe(
      false,
    );
    expect(isDefaultGalleryParams({ order: "desc", member: null, type: "all", day: "11-09" })).toBe(
      false,
    );
  });
});
