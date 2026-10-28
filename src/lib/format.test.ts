import { describe, expect, it } from "vitest";
import {
  currencyLabel,
  formatCompact,
  formatCurrency,
  formatDate,
  formatDuration,
  formatDurationLong,
  formatInteger,
  formatMinuteOffset,
  formatPercent,
} from "./format";

describe("format", () => {
  it("formats integers with grouping", () => {
    expect(formatInteger(1234)).toBe("1,234");
    expect(formatInteger(null)).toBe("—");
  });

  it("formats compact numbers", () => {
    expect(formatCompact(12000)).toBe("1.2万");
    expect(formatCompact(null)).toBe("—");
  });

  it("formats durations", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3661)).toBe("1:01:01");
    expect(formatDurationLong(29800)).toBe("8 小时 17 分");
    expect(formatDurationLong(90)).toBe("2 分");
  });

  it("formats JST dates and times", () => {
    expect(formatDate("2026-10-13T20:16:46+09:00")).toBe("10/13");
  });

  it("formats percentages and currencies", () => {
    expect(formatPercent(12.345)).toBe("12.3%");
    expect(formatPercent(null)).toBe("—");
    expect(formatCurrency("NT$", 360)).toBe("NT$ 360");
    expect(currencyLabel("₩")).toBe("韩元");
  });

  it("formats minute offsets", () => {
    expect(formatMinuteOffset(5)).toBe("5 分");
    expect(formatMinuteOffset(125)).toBe("2:05");
  });
});
