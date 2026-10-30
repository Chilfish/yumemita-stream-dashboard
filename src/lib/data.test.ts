import { describe, expect, it } from "vitest";
import {
  LOCAL_DATA_BASE,
  REMOTE_DATA_BASE,
  fetchManifest,
  thumbnailSrcSet,
  thumbnailUrl,
} from "./data";
import { THUMB_VARIANTS, thumbVariantName } from "./thumb-variants";

/** 配置了对象存储时走远端，否则走构建快照——两种环境都要有确定的期望值。 */
const BASE = REMOTE_DATA_BASE || LOCAL_DATA_BASE;

describe("thumbnailUrl", () => {
  it("points at the mirrored original jpg", () => {
    expect(thumbnailUrl("nonoka", "W0bKqP-Eyj4")).toBe(`${BASE}/nonoka/thumbs/W0bKqP-Eyj4.jpg`);
  });

  it("percent-encodes ids so they address the published key", () => {
    expect(thumbnailUrl("nonoka", "a b")).toBe(`${BASE}/nonoka/thumbs/a%20b.jpg`);
  });
});

describe("thumbnailSrcSet", () => {
  it("lists every webp variant with a width descriptor", () => {
    expect(thumbnailSrcSet("nonoka", "abc")).toBe(
      `${BASE}/nonoka/thumbs/abc.480.webp 480w, ${BASE}/nonoka/thumbs/abc.960.webp 960w, ${BASE}/nonoka/thumbs/abc.1280.webp 1280w`,
    );
  });

  it("keeps widths ascending so the browser can pick the smallest match", () => {
    const widths = [...THUMB_VARIANTS];
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    expect(new Set(widths).size).toBe(widths.length);
  });
});

describe("thumbVariantName", () => {
  it("is the single naming rule shared by fetch:thumbs, publish:data and the page", () => {
    expect(thumbVariantName("abc", 480)).toBe("abc.480.webp");
  });
});

describe("fetchManifest", () => {
  it("shares one request between concurrent consumers", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ streams: [{ videoId: "concurrent-test" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    try {
      const [first, second] = await Promise.all([
        fetchManifest("concurrent-test"),
        fetchManifest("concurrent-test"),
      ]);
      expect(calls).toBe(1);
      expect(first).toBe(second);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
