import { describe, expect, it } from "vitest";
import {
  MAX_COMPARE,
  datasetPath,
  parseCompareIds,
  sectionFromPathname,
  streamPath,
  toggleCompareId,
  viewPath,
} from "./routes";

describe("route paths", () => {
  it("builds dataset and view paths", () => {
    expect(datasetPath("nonoka")).toBe("/nonoka");
    expect(viewPath("nonoka", "overview")).toBe("/nonoka/overview");
    expect(streamPath("nonoka", "abc123")).toBe("/nonoka/stream/abc123");
  });

  it("encodes path segments", () => {
    expect(streamPath("nonoka", "a/b")).toBe("/nonoka/stream/a%2Fb");
  });
});

describe("sectionFromPathname", () => {
  it("returns the view segment", () => {
    expect(sectionFromPathname("/nonoka/compare")).toBe("compare");
    expect(sectionFromPathname("/nonoka/stream/abc")).toBe("stream");
  });

  it("falls back to overview", () => {
    expect(sectionFromPathname("/nonoka")).toBe("overview");
    expect(sectionFromPathname("/nonoka/nope")).toBe("overview");
    expect(sectionFromPathname("/")).toBe("overview");
  });
});

describe("parseCompareIds", () => {
  it("trims, drops empty values and dedupes", () => {
    expect(parseCompareIds(" a, b ,a,,c ")).toEqual(["a", "b", "c"]);
  });

  it("returns an empty list for missing params", () => {
    expect(parseCompareIds(null)).toEqual([]);
    expect(parseCompareIds("")).toEqual([]);
  });

  it("caps the number of ids", () => {
    expect(parseCompareIds("a,b,c,d,e,f")).toHaveLength(MAX_COMPARE);
  });
});

describe("toggleCompareId", () => {
  it("adds and removes ids", () => {
    expect(toggleCompareId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleCompareId(["a", "b"], "a")).toEqual(["b"]);
  });

  it("refuses to exceed the maximum", () => {
    const ids = ["a", "b", "c", "d"];
    expect(toggleCompareId(ids, "e")).toBe(ids);
  });

  it("still allows removing when full", () => {
    expect(toggleCompareId(["a", "b", "c", "d"], "b")).toEqual(["a", "c", "d"]);
  });
});
