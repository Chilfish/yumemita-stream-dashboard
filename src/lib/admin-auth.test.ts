import { describe, expect, it } from "vitest";
import {
  parseBasicAuth,
  safeEqual,
  signSession,
  verifySession,
} from "./admin-auth";

describe("parseBasicAuth", () => {
  it("按第一个冒号切分，密码里允许冒号", () => {
    const header = `Basic ${btoa("admin:pa:ss")}`;
    expect(parseBasicAuth(header)).toEqual({ user: "admin", password: "pa:ss" });
  });

  it("非 Basic 或非法 base64 返回 null", () => {
    expect(parseBasicAuth(null)).toBeNull();
    expect(parseBasicAuth("Bearer token")).toBeNull();
    expect(parseBasicAuth("Basic !!!")).toBeNull();
  });
});

describe("safeEqual", () => {
  it("长度不同或内容不同都返回 false", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });
});

describe("签名 Cookie", () => {
  const secret = "test-secret";
  const now = new Date("2026-11-07T12:00:00Z");

  it("有效期内通过", async () => {
    const cookie = await signSession(now.getTime() + 60_000, secret);
    expect(await verifySession(cookie, secret, now)).toBe(true);
  });

  it("过期、篡改或换密钥都拒绝", async () => {
    const expired = await signSession(now.getTime() - 1, secret);
    const valid = await signSession(now.getTime() + 60_000, secret);
    const tampered = valid.replace(/\.[^.]+$/, ".AAAA");

    expect(await verifySession(expired, secret, now)).toBe(false);
    expect(await verifySession(tampered, secret, now)).toBe(false);
    expect(await verifySession(valid, "other-secret", now)).toBe(false);
    expect(await verifySession(undefined, secret, now)).toBe(false);
  });
});
