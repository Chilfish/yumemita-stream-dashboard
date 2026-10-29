import { describe, expect, it } from "vitest";
import { contrastRatio, ensureContrast, memberAccent, readableOn } from "./color";

const LIGHT_BG = "#f4f4f6";
const DARK_BG = "#161617";

describe("color", () => {
  it("computes WCAG contrast ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("darkens brand colors that fail on the light background", () => {
    const accent = memberAccent("#FFEE55", "light");
    expect(accent).not.toBe("#FFEE55");
    expect(contrastRatio(accent, LIGHT_BG)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps colors that already pass", () => {
    expect(memberAccent("#b8461f", "light")).toBe("#b8461f");
    expect(memberAccent("#FFEE55", "dark")).toBe("#FFEE55");
  });

  it("lightens colors on the dark background when needed", () => {
    const accent = memberAccent("#4477CC", "dark");
    expect(contrastRatio(accent, DARK_BG)).toBeGreaterThanOrEqual(4.5);
  });

  it("passes invalid values through", () => {
    expect(ensureContrast("not-a-color", LIGHT_BG)).toBe("not-a-color");
  });

  it("picks a readable foreground for member color chips", () => {
    expect(readableOn("#FFEE55")).toBe("#1b1b1d");
    expect(readableOn("#b8461f")).toBe("#ffffff");
  });
});
