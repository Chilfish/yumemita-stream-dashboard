import { describe, expect, it } from "vitest";
import { isMemberOnly, memberOnlyUnlocked } from "./visibility";

describe("isMemberOnly", () => {
  it("只认 subscriber_only", () => {
    expect(isMemberOnly("subscriber_only")).toBe(true);
    expect(isMemberOnly("public")).toBe(false);
    expect(isMemberOnly(null)).toBe(false);
    expect(isMemberOnly(undefined)).toBe(false);
  });
});

describe("memberOnlyUnlocked", () => {
  it("环境变量没配置时永远锁着", () => {
    expect(memberOnlyUnlocked("anything", undefined)).toBe(false);
    expect(memberOnlyUnlocked("anything", null)).toBe(false);
    expect(memberOnlyUnlocked("anything", "")).toBe(false);
  });

  it("必须带上匹配的 query 值", () => {
    expect(memberOnlyUnlocked("s3cret", "s3cret")).toBe(true);
    expect(memberOnlyUnlocked("wrong", "s3cret")).toBe(false);
    expect(memberOnlyUnlocked(null, "s3cret")).toBe(false);
    expect(memberOnlyUnlocked("", "s3cret")).toBe(false);
  });
});
