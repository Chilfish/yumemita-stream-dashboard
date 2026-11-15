import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "@/lib/security-headers";

function directive(policy: string, name: string): string {
  return policy.split("; ").find(part => part.startsWith(`${name} `)) ?? "";
}

describe("contentSecurityPolicy", () => {
  it("脚本只允许本站与 Cloudflare 统计，禁止内嵌对象与外部框架", () => {
    const policy = contentSecurityPolicy();
    expect(directive(policy, "script-src")).toBe(
      "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
    );
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'self'");
  });

  it("media 域名同时进入 img-src 与 connect-src", () => {
    const policy = contentSecurityPolicy({ assetOrigin: "https://cdn.example.com/" });
    expect(directive(policy, "img-src")).toContain("https://cdn.example.com");
    expect(directive(policy, "connect-src")).toContain("https://cdn.example.com");
    expect(policy).not.toContain("https://cdn.example.com/");
  });

  it("媒体地址带路径时收敛到 origin，否则子路径会被精确匹配挡掉", () => {
    const policy = contentSecurityPolicy({ assetOrigin: "http://127.0.0.1:9000/ymmt-data" });
    expect(directive(policy, "img-src")).toBe(
      "img-src 'self' data: blob: http://127.0.0.1:9000",
    );
    expect(directive(policy, "connect-src")).toContain("http://127.0.0.1:9000");
  });

  it("未配置媒体域名时只放行本站与 blob，统计上报仍然可发", () => {
    const policy = contentSecurityPolicy({ assetOrigin: "" });
    expect(directive(policy, "img-src")).toBe("img-src 'self' data: blob:");
    expect(directive(policy, "connect-src")).toBe("connect-src 'self' https://cloudflareinsights.com");
  });
});
