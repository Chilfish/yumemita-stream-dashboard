import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "@/lib/security-headers";

function directive(policy: string, name: string): string {
  return policy.split("; ").find(part => part.startsWith(`${name} `)) ?? "";
}

describe("contentSecurityPolicy", () => {
  it("脚本只允许本站，禁止内嵌对象与外部框架", () => {
    const policy = contentSecurityPolicy();
    expect(directive(policy, "script-src")).toBe("script-src 'self' 'unsafe-inline'");
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'self'");
  });

  it("媒体域名同时进入 img-src 与 connect-src", () => {
    const policy = contentSecurityPolicy({ assetOrigin: "https://cdn.example.com/" });
    expect(directive(policy, "img-src")).toContain("https://cdn.example.com");
    expect(directive(policy, "connect-src")).toContain("https://cdn.example.com");
    expect(policy).not.toContain("https://cdn.example.com/");
  });

  it("未配置媒体域名时只放行本站与 blob", () => {
    const policy = contentSecurityPolicy({ assetOrigin: "" });
    expect(directive(policy, "img-src")).toBe("img-src 'self' data: blob:");
    expect(directive(policy, "connect-src")).toBe("connect-src 'self'");
  });
});
