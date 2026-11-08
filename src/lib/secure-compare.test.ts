import { describe, expect, it } from "vitest";
import { safeEqual } from "./secure-compare";

describe("safeEqual", () => {
  it("内容相同才返回 true", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
