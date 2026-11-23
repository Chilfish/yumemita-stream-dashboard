import { describe, expect, it } from "vitest";
import { renderLlmsTxt, type LlmsStreamInput } from "@/lib/agent-llms";

const origin = "https://example.com";

const members = [
  { id: "arale", label: "仲町あられ", streamCount: 534 },
  { id: "nonoka", label: "宮永ののか", streamCount: 323 },
];

function stream(overrides: Partial<LlmsStreamInput>): LlmsStreamInput {
  return {
    datasetId: "arale",
    videoId: "vid1",
    title: "歌枠",
    date: "2026-11-14",
    availability: "public",
    ...overrides,
  };
}

function lines(overrides: Partial<Parameters<typeof renderLlmsTxt>[0]> = {}): string[] {
  return renderLlmsTxt({ origin, members, streams: [stream({})], ...overrides }).split("\n");
}

/** H2 段里除了分隔空行只应有 `- [name](url): notes`；正文段不许出现在 H2 之后。 */
function fileListBullets(all: string[]): string[] {
  const start = all.findIndex(line => line.startsWith("## "));
  return all
    .slice(start)
    .filter(line => line.startsWith("- ") || line.startsWith("* ") || /^\d+[.)]\s/.test(line));
}

describe("renderLlmsTxt", () => {
  it("第一行是 H1，紧随其后的 blockquote 是摘要", () => {
    const all = lines();
    expect(all[0]).toBe("# ゆめみた 配信数据台");
    expect(all[1]).toBe("");
    expect(all[2].startsWith("> ")).toBe(true);
  });

  it("每个 H2 段都只有合规的文件列表条目", () => {
    const bullets = fileListBullets(lines());
    expect(bullets.length).toBeGreaterThan(0);
    for (const bullet of bullets) {
      // `- [name](url): notes` —— 缺冒号时解析器读不到 notes。
      expect(bullet).toMatch(/^- \[[^[\]]+\]\(https?:\/\/[^()\s]+\): \S/);
    }
  });

  it("没有空 H2 段", () => {
    const all = lines();
    for (let index = 0; index < all.length; index += 1) {
      if (!all[index].startsWith("## ")) continue;
      const next = all.slice(index + 1).find(line => line.trim() !== "");
      expect(next?.startsWith("- ") ?? false).toBe(true);
    }
  });

  it("结尾是 Optional 段", () => {
    const all = lines();
    expect(all.filter(line => line.startsWith("## ")).at(-1)).toBe("## Optional");
  });

  it("成员条目带上数据集 id 与场次数", () => {
    const text = lines().join("\n");
    expect(text).toContain("(https://example.com/arale): 数据集 id `arale`，534 场");
  });

  it("最近场次指向 .md 视图而不是 HTML 目录页", () => {
    const text = lines().join("\n");
    expect(text).toContain("(https://example.com/arale/stream/vid1.md): 仲町あられ · 2026-11-14");
    expect(text).not.toContain("/arale/streams");
  });

  it("会员限定场次不进最近场次", () => {
    const all = lines({
      streams: [
        stream({ videoId: "locked", availability: "subscriber_only" }),
        stream({ videoId: "open" }),
      ],
    });
    const text = all.join("\n");
    expect(text).not.toContain("locked.md");
    expect(text).toContain("open.md");
  });

  it("每成员最多 4 条，保持输入顺序", () => {
    const streams = Array.from({ length: 6 }, (_, index) =>
      stream({ videoId: `vid${index}`, date: `2026-11-1${index}` }),
    );
    const all = lines({ streams });
    const start = all.indexOf("## 最近场次");
    const end = all.findIndex((line, index) => index > start && line.startsWith("## "));
    const recent = all.slice(start, end).filter(line => line.startsWith("- "));
    expect(recent).toHaveLength(4);
    expect(recent[0]).toContain("vid0.md");
  });

  it("标题里的 ASCII 方括号换成全角，避免破坏链接语法", () => {
    const all = lines({ streams: [stream({ title: "[初] 歌枠" })] });
    const bullet = all.find(line => line.includes("/stream/vid1.md"));
    expect(bullet).toBeDefined();
    expect(bullet).toMatch(/^- \[［初］ 歌枠\]\(/);
  });

  it("标题过长时截断并保留省略号", () => {
    const all = lines({ streams: [stream({ title: "あ".repeat(80) })] });
    const bullet = all.find(line => line.includes("/stream/vid1.md")) ?? "";
    const text = bullet.slice(bullet.indexOf("["), bullet.indexOf("]("));
    expect(Array.from(text).length).toBeLessThanOrEqual(50);
    expect(text.endsWith("…")).toBe(true);
  });

  it("空库时不留空 H2 段", () => {
    const all = lines({ members: [], streams: [] });
    expect(all.join("\n")).toContain("尚未收录任何成员");
    for (let index = 0; index < all.length; index += 1) {
      if (!all[index].startsWith("## ")) continue;
      const next = all.slice(index + 1).find(line => line.trim() !== "");
      expect(next?.startsWith("- ") ?? false).toBe(true);
    }
  });

  it("origin 末尾斜杠不会产生双斜杠", () => {
    const text = renderLlmsTxt({ origin: "https://example.com/", members, streams: [stream({})] });
    expect(text).not.toContain("example.com//");
  });

  it("结构化接口用真实存在的路由与参数", () => {
    const text = lines().join("\n");
    expect(text).toContain("https://example.com/api/streams?member=arale&limit=20");
    expect(text).toContain("https://example.com/schemas/stream-search.v1.json");
    expect(text).toContain("https://example.com/api/packs/arale/vid1");
    expect(text).toContain("https://example.com/api/densities/arale?ids=vid1");
    expect(text).toContain("https://example.com/api/transcripts/arale/vid1");
    expect(text).toContain("?full=1");
    expect(text).toContain("?transcript=0");
  });
});
