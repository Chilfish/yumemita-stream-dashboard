import { describe, expect, it } from "vitest";
import {
  createMinuteOptions,
  formatTime,
  normalizeMinuteStep,
  normalizeTime,
  parseTime,
  stepTime,
} from "./time";

describe("parseTime", () => {
  it("带冒号或点号时返回分钟数", () => {
    expect(parseTime("09:30")).toBe(570);
    expect(parseTime("9.30")).toBe(570);
  });

  it("紧凑数字按后两位拆出小时与分钟", () => {
    expect(parseTime("930")).toBe(570);
    expect(parseTime("1500")).toBe(900);
  });

  it("只有小时时分钟补 0", () => {
    expect(parseTime("9")).toBe(540);
  });

  it("12 小时制按 AM / PM 换算成 24 小时", () => {
    expect(parseTime("12am")).toBe(0);
    expect(parseTime("12pm")).toBe(720);
    expect(parseTime("1:30pm")).toBe(810);
    expect(parseTime("9 a.m.")).toBe(540);
  });

  it("中文写法可识别", () => {
    expect(parseTime("下午3点30分")).toBe(930);
    expect(parseTime("晚上8点")).toBe(1200);
    expect(parseTime("上午9时")).toBe(540);
    expect(parseTime("中午12点")).toBe(720);
  });

  it("全角数字可识别", () => {
    expect(parseTime("０９：３０")).toBe(570);
  });

  it("小时越界返回 null", () => {
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("13pm")).toBeNull();
  });

  it("分钟越界返回 null", () => {
    expect(parseTime("9:60")).toBeNull();
  });

  it("无法识别或空输入返回 null", () => {
    expect(parseTime("abc")).toBeNull();
    expect(parseTime("   ")).toBeNull();
  });
});

describe("formatTime", () => {
  it("24 小时制补零", () => {
    expect(formatTime(5)).toBe("00:05");
    expect(formatTime(570)).toBe("09:30");
  });

  it("12 小时制追加 AM / PM", () => {
    expect(formatTime(0, true)).toBe("12:00 AM");
    expect(formatTime(720, true)).toBe("12:00 PM");
    expect(formatTime(13 * 60 + 5, true)).toBe("1:05 PM");
  });

  it("跨天回绕到当天", () => {
    expect(formatTime(1445)).toBe("00:05");
    expect(formatTime(-30)).toBe("23:30");
  });
});

describe("normalizeTime", () => {
  it("合法输入返回规范时间", () => {
    expect(normalizeTime("930")).toBe("09:30");
    expect(normalizeTime("下午3点")).toBe("15:00");
  });

  it("非法输入返回 null", () => {
    expect(normalizeTime("abc")).toBeNull();
  });
});

describe("stepTime", () => {
  it("上调跨过午夜", () => {
    expect(stepTime(23 * 60 + 50, 15, 1)).toBe(5);
  });

  it("下调跨回前一天", () => {
    expect(stepTime(5, 15, -1)).toBe(1430);
  });

  it("步长为 0 时按 1 分钟处理", () => {
    expect(stepTime(0, 0, 1)).toBe(1);
  });
});

describe("normalizeMinuteStep", () => {
  it("能整除 60 时保留原值", () => {
    expect(normalizeMinuteStep(10)).toBe(10);
    expect(normalizeMinuteStep(15)).toBe(15);
    expect(normalizeMinuteStep(30)).toBe(30);
  });

  it("不能整除 60 或越界时回退到 10", () => {
    expect(normalizeMinuteStep(7)).toBe(10);
    expect(normalizeMinuteStep(0)).toBe(10);
    expect(normalizeMinuteStep(90)).toBe(10);
  });
});

describe("createMinuteOptions", () => {
  it("默认按 10 分钟分组", () => {
    expect(createMinuteOptions()).toEqual(["00", "10", "20", "30", "40", "50"]);
  });

  it("自定义间隔", () => {
    expect(createMinuteOptions(15)).toEqual(["00", "15", "30", "45"]);
  });

  it("不能整除 60 的间隔回退到 10 分钟", () => {
    expect(createMinuteOptions(7)).toHaveLength(6);
  });
});
