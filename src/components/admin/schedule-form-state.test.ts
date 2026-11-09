import { describe, expect, it } from "vitest";
import { hasTimeZone } from "@/lib/schedule";
import { jstTime } from "./schedule-form-state";

describe("jstTime", () => {
  it("始终补零为 HH:mm", () => {
    expect(jstTime("2026-11-08T13:00:00.000Z")).toBe("22:00");
    expect(jstTime("2026-11-08T15:05:00.000Z")).toBe("00:05");
    expect(jstTime("2026-11-08T15:09:00.000Z")).toBe("00:09");
    expect(jstTime("2026-11-08T12:30:00.000Z")).toBe("21:30");
  });

  it("回填值拼出的 scheduledAt 能通过服务端校验", () => {
    const times = [
      "2026-11-08T13:00:00.000Z",
      "2026-11-08T15:05:00.000Z",
      "2026-11-08T15:09:00.000Z",
      "2026-11-08T12:30:00.000Z",
    ];
    for (const iso of times) {
      expect(hasTimeZone(`2026-11-08T${jstTime(iso)}:00+09:00`)).toBe(true);
    }
  });

  it("没有精确时间时回落到 20:00", () => {
    expect(jstTime(null)).toBe("20:00");
  });
});
