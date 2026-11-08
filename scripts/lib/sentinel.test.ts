import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sentinelIsFresh } from "./sentinel";

let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("sentinelIsFresh", () => {
  it("不存在的哨兵视为无效", () => {
    expect(sentinelIsFresh("/definitely/not/here.txt")).toBe(false);
  });

  it("有效期内的哨兵有效，超过有效期后失效", () => {
    dir = mkdtempSync(join(tmpdir(), "sentinel-"));
    const path = join(dir, "chat-unavailable.txt");
    writeFileSync(path, "no replay\n");
    const now = Date.now();
    expect(sentinelIsFresh(path, now)).toBe(true);
    expect(sentinelIsFresh(path, now + 31 * 86_400_000)).toBe(false);
  });
});
