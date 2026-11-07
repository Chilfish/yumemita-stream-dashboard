import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSCRIPT_PARAMS,
  hasTranscriptFilters,
  parseTranscriptParams,
  transcriptFilterCount,
  writeTranscriptParams,
} from "./transcript-params";

describe("transcript params", () => {
  it("parses defaults and ignores invalid values", () => {
    expect(parseTranscriptParams(new URLSearchParams())).toEqual(DEFAULT_TRANSCRIPT_PARAMS);
    expect(
      parseTranscriptParams(new URLSearchParams("sort=nope&dense=0&q=%20%20&tags=%20")),
    ).toEqual(DEFAULT_TRANSCRIPT_PARAMS);
  });

  it("normalizes tags and keeps valid values", () => {
    expect(
      parseTranscriptParams(
        new URLSearchParams("q=13th&tags=杂谈,Live回顾,杂谈&sort=oldest&dense=1"),
      ),
    ).toEqual({
      q: "13th",
      tags: ["Live回顾", "杂谈"],
      sort: "oldest",
      dense: true,
    });
  });

  it("writes only non-default params and preserves unrelated params", () => {
    const base = new URLSearchParams("month=2026-10");
    const next = writeTranscriptParams(base, {
      q: "13th",
      tags: ["杂谈", "Live回顾"],
      sort: "title",
      dense: true,
    });

    expect(next.get("month")).toBe("2026-10");
    expect(next.get("q")).toBe("13th");
    expect(next.get("tags")).toBe("Live回顾,杂谈");
    expect(next.get("sort")).toBe("title");
    expect(next.get("dense")).toBe("1");
  });

  it("removes params when they return to defaults", () => {
    const next = writeTranscriptParams(
      new URLSearchParams("q=x&tags=a&sort=title&dense=1"),
      DEFAULT_TRANSCRIPT_PARAMS,
    );
    expect(next.toString()).toBe("");
  });

  it("counts active filters for the mobile trigger", () => {
    expect(transcriptFilterCount(DEFAULT_TRANSCRIPT_PARAMS)).toBe(0);
    expect(
      transcriptFilterCount({ q: "x", tags: ["a", "b"], sort: "oldest", dense: true }),
    ).toBe(4);
    expect(hasTranscriptFilters({ ...DEFAULT_TRANSCRIPT_PARAMS, q: "x" })).toBe(true);
    expect(hasTranscriptFilters({ ...DEFAULT_TRANSCRIPT_PARAMS, tags: ["a"] })).toBe(true);
    expect(hasTranscriptFilters({ ...DEFAULT_TRANSCRIPT_PARAMS, sort: "title" })).toBe(false);
  });
});
