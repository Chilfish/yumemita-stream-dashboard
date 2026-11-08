import { describe, expect, it } from "vitest";
import { isAdminPath, isApiPath, normalizePathname } from "./admin-path";

describe("normalizePathname", () => {
  it("去掉尾斜杠，根路径保持 /", () => {
    expect(normalizePathname("/")).toBe("/");
    expect(normalizePathname("/admin/")).toBe("/admin");
    expect(normalizePathname("//admin//")).toBe("//admin");
  });
});

describe("isAdminPath", () => {
  it("覆盖有尾斜杠与无尾斜杠的 API 路径", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/")).toBe(true);
    expect(isAdminPath("/admin/schedule")).toBe(true);
    expect(isAdminPath("/api/admin")).toBe(true);
    expect(isAdminPath("/api/admin/")).toBe(true);
    expect(isAdminPath("/api/admin/schedule")).toBe(true);
  });

  it("不误伤相近前缀", () => {
    expect(isAdminPath("/administrator")).toBe(false);
    expect(isAdminPath("/api/adminx")).toBe(false);
    expect(isAdminPath("/api/packs")).toBe(false);
  });
});

describe("isApiPath", () => {
  it("只认 /api/ 前缀", () => {
    expect(isApiPath("/api/admin/schedule")).toBe(true);
    expect(isApiPath("/api")).toBe(false);
    expect(isApiPath("/admin")).toBe(false);
  });
});
