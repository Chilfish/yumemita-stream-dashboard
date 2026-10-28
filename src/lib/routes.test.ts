import { describe, expect, it } from "vitest";
import {
  MAX_COMPARE,
  datasetPath,
  homePath,
  parseCompareIds,
  parseStreamSubView,
  sectionFromPathname,
  streamPath,
  streamsPath,
  toggleCompareId,
  viewPath,
} from "./routes";

describe("route paths", () => {
  it("builds member and section paths", () => {
    expect(datasetPath("nonoka")).toBe("/nonoka");
    expect(homePath("nonoka")).toBe("/nonoka");
    expect(streamsPath("nonoka")).toBe("/nonoka/streams");
    expect(viewPath("nonoka", "home")).toBe("/nonoka");
    expect(viewPath("nonoka", "streams")).toBe("/nonoka/streams");
    expect(viewPath("nonoka", "stream")).toBe("/nonoka/stream");
    expect(viewPath("nonoka", "compare")).toBe("/nonoka/compare");
    expect(viewPath("nonoka", "about")).toBe("/nonoka/about");
  });

  it("keeps the default subview out of the URL", () => {
    expect(streamPath("nonoka", "abc123")).toBe("/nonoka/stream/abc123");
    expect(streamPath("nonoka", "abc123", "overview")).toBe("/nonoka/stream/abc123");
    expect(streamPath("nonoka", "abc123", "timeline")).toBe(
      "/nonoka/stream/abc123?view=timeline",
    );
  });

  it("encodes path segments", () => {
    expect(streamPath("nonoka", "a/b")).toBe("/nonoka/stream/a%2Fb");
  });
});

describe("sectionFromPathname", () => {
  it("returns the section segment", () => {
    expect(sectionFromPathname("/nonoka/compare")).toBe("compare");
    expect(sectionFromPathname("/nonoka/streams")).toBe("streams");
    expect(sectionFromPathname("/nonoka/stream/abc")).toBe("stream");
  });

  it("maps legacy segments", () => {
    expect(sectionFromPathname("/nonoka/table")).toBe("streams");
    expect(sectionFromPathname("/nonoka/overview")).toBe("home");
  });

  it("falls back to home", () => {
    expect(sectionFromPathname("/nonoka")).toBe("home");
    expect(sectionFromPathname("/nonoka/nope")).toBe("home");
    expect(sectionFromPathname("/")).toBe("home");
  });
});

describe("parseStreamSubView", () => {
  it("accepts known subviews and falls back to overview", () => {
    expect(parseStreamSubView("timeline")).toBe("timeline");
    expect(parseStreamSubView("paid")).toBe("paid");
    expect(parseStreamSubView("nope")).toBe("overview");
    expect(parseStreamSubView(null)).toBe("overview");
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
