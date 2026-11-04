import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPARE_WINDOW,
  compareSearch,
  parseCompareParams,
} from "./compare-params";

const DATASETS = [{ id: "nonoka" }, { id: "arale" }, { id: "ritsu" }];

function parse(query: string) {
  return parseCompareParams(new URLSearchParams(query), DATASETS);
}

describe("parseCompareParams", () => {
  it("defaults to all members, all types and six months", () => {
    expect(parse("")).toEqual({
      members: ["nonoka", "arale", "ritsu"],
      type: null,
      months: DEFAULT_COMPARE_WINDOW,
    });
  });

  it("drops unknown and duplicate members", () => {
    expect(parse("members=arale,nope,arale,nonoka").members).toEqual(["arale", "nonoka"]);
  });

  it("falls back to all members when the member list is empty or invalid", () => {
    expect(parse("members=").members).toEqual(["nonoka", "arale", "ritsu"]);
    expect(parse("members=nope").members).toEqual(["nonoka", "arale", "ritsu"]);
  });

  it("accepts known content types and rejects the rest", () => {
    expect(parse("type=sing").type).toBe("sing");
    expect(parse("type=event").type).toBe("event");
    expect(parse("type=nope").type).toBeNull();
  });

  it("accepts only the supported windows", () => {
    expect(parse("months=3").months).toBe(3);
    expect(parse("months=12").months).toBe(12);
    expect(parse("months=all").months).toBe("all");
    expect(parse("months=9").months).toBe(DEFAULT_COMPARE_WINDOW);
    expect(parse("months=nope").months).toBe(DEFAULT_COMPARE_WINDOW);
  });
});

describe("compareSearch", () => {
  const ids = DATASETS.map(dataset => dataset.id);

  it("omits every default value", () => {
    expect(
      compareSearch({ members: ids, type: null, months: DEFAULT_COMPARE_WINDOW }, ids),
    ).toBe("");
  });

  it("writes only non-default values", () => {
    expect(
      compareSearch(
        { members: ["arale", "nonoka"], type: "sing", months: "all" },
        ids,
      ),
    ).toBe("members=arale%2Cnonoka&type=sing&months=all");
  });

  it("round-trips through parse", () => {
    const params = {
      members: ["arale", "nonoka"],
      type: "talk" as const,
      months: 3 as const,
    };
    const search = compareSearch(params, ids);
    expect(parse(search)).toEqual(params);
  });
});
