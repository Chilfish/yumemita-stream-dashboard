import { describe, expect, it } from "vitest";
import {
  extractToc,
  groupTranscriptsByMonth,
  parseFrontmatter,
  parseTranscriptFile,
  rewriteTimecodes,
  slugifyHeading,
  sortTranscriptEntries,
  timecodeSeconds,
  toIndexEntry,
  transcriptObjectKey,
  youtubeTimeUrl,
} from "./transcripts";

const SAMPLE = `---
videoId: W0bKqP-Eyj4
date: 2026-10-13
title: "【ライブ振り返り】13th live をふりかえる"
members: [nonoka, arale]
tags: ['杂谈', "13th live"]
summary: 一场把 13th live 从头聊到尾的复盘。
---

## 开场

[00:00:12] 大家好，今天想聊聊 13th live……

## 话题一

[1:02:03] 第二段。

### 细节

内容。
`;

describe("parseFrontmatter", () => {
  it("parses strings, inline arrays and quoted values", () => {
    const { data, body } = parseFrontmatter(SAMPLE);

    expect(data.videoId).toBe("W0bKqP-Eyj4");
    expect(data.date).toBe("2026-10-13");
    expect(data.title).toBe("【ライブ振り返り】13th live をふりかえる");
    expect(data.members).toEqual(["nonoka", "arale"]);
    expect(data.tags).toEqual(["杂谈", "13th live"]);
    expect(body.trimStart().startsWith("## 开场")).toBe(true);
  });

  it("parses numbers and keeps unknown keys", () => {
    const { data } = parseFrontmatter("---\nvideoId: abc\nyear: 2026\nratio: 1.5\n---\n正文");
    expect(data.year).toBe(2026);
    expect(data.ratio).toBe(1.5);
  });

  it("treats text without a closed frontmatter block as body", () => {
    const text = "---\nvideoId: abc\n\n## 开场\n";
    const { data, body } = parseFrontmatter(text);
    expect(data).toEqual({});
    expect(body).toBe(text);
  });

  it("ignores comment lines", () => {
    const { data } = parseFrontmatter("---\n# 备注\nvideoId: abc\n---\n");
    expect(data).toEqual({ videoId: "abc" });
  });
});

describe("parseTranscriptFile", () => {
  it("derives datasetId from the path and keeps the markdown body", () => {
    const file = parseTranscriptFile(SAMPLE, "/content/transcripts/nonoka/W0bKqP-Eyj4.md");

    expect(file.datasetId).toBe("nonoka");
    expect(file.videoId).toBe("W0bKqP-Eyj4");
    expect(file.frontmatter.members).toEqual(["nonoka", "arale"]);
    expect(file.frontmatter.summary).toContain("13th live");
    expect(file.markdown.startsWith("## 开场")).toBe(true);
    expect(file.toc.map(item => item.text)).toEqual(["开场", "话题一", "细节"]);
  });

  it("returns an empty datasetId for root-level files", () => {
    const file = parseTranscriptFile(SAMPLE, "content/transcripts/README.md");
    expect(file.datasetId).toBe("");
  });

  it("throws when frontmatter has no videoId", () => {
    expect(() => parseTranscriptFile("---\ntitle: 无 id\n---\n正文", "a/nonoka/x.md")).toThrow(
      /videoId/,
    );
  });
});

describe("rewriteTimecodes", () => {
  it("turns a leading mm:ss timecode into a YouTube deep link", () => {
    expect(rewriteTimecodes("[12:34] 开聊", "W0bKqP-Eyj4")).toBe(
      "[12:34](https://www.youtube.com/watch?v=W0bKqP-Eyj4&t=754s) 开聊",
    );
  });

  it("turns a leading hh:mm:ss timecode into seconds", () => {
    expect(rewriteTimecodes("[1:02:03] 第二段", "abc")).toBe(
      "[1:02:03](https://www.youtube.com/watch?v=abc&t=3723s) 第二段",
    );
    expect(rewriteTimecodes("[00:12:34] 第三段", "abc")).toBe(
      "[00:12:34](https://www.youtube.com/watch?v=abc&t=754s) 第三段",
    );
  });

  it("rewrites every line and keeps indentation, list and quote prefixes", () => {
    const markdown = "第一行\n  [0:10] 缩进\n- [0:20] 列表\n> [0:30] 引用";
    const result = rewriteTimecodes(markdown, "abc");
    expect(result).toBe(
      [
        "第一行",
        "  [0:10](https://www.youtube.com/watch?v=abc&t=10s) 缩进",
        "- [0:20](https://www.youtube.com/watch?v=abc&t=20s) 列表",
        "> [0:30](https://www.youtube.com/watch?v=abc&t=30s) 引用",
      ].join("\n"),
    );
  });

  it("leaves mid-line brackets, existing links and code blocks alone", () => {
    const markdown = ["前言 [12:34] 不是行首", "[12:34](https://example.com)", "```", "[12:34] 代码", "```"].join("\n");
    expect(rewriteTimecodes(markdown, "abc")).toBe(markdown);
  });

  it("keeps line numbers stable", () => {
    const before = "## 开场\n[1:00] 一\n[2:00] 二".split("\n").length;
    const after = rewriteTimecodes("## 开场\n[1:00] 一\n[2:00] 二", "abc").split("\n").length;
    expect(after).toBe(before);
  });

  it("exposes seconds and url helpers", () => {
    expect(timecodeSeconds("0:30")).toBe(30);
    expect(timecodeSeconds("12:34")).toBe(754);
    expect(timecodeSeconds("1:00:00")).toBe(3600);
    expect(youtubeTimeUrl("abc", 0)).toBe("https://www.youtube.com/watch?v=abc&t=0s");
    expect(transcriptObjectKey("nonoka", "W0bKqP-Eyj4")).toBe(
      "nonoka/transcripts/W0bKqP-Eyj4.json",
    );
  });
});

describe("extractToc", () => {
  it("collects h2/h3 with stable ids and source lines", () => {
    const toc = extractToc("## 开场\n\n正文\n\n### 细节 **加粗**\n\n#### 不算");
    expect(toc).toEqual([
      { id: "开场", text: "开场", depth: 2, line: 1 },
      { id: "细节-加粗", text: "细节 加粗", depth: 3, line: 5 },
    ]);
  });

  it("dedupes repeated headings and skips fenced code", () => {
    const toc = extractToc("## 话题\n```\n## 不是标题\n```\n## 话题");
    expect(toc.map(item => item.id)).toEqual(["话题", "话题-2"]);
  });

  it("slugifies latin, CJK and punctuation", () => {
    expect(slugifyHeading("Open Chat & Q/A")).toBe("open-chat-qa");
    expect(slugifyHeading("  开场  ")).toBe("开场");
    expect(slugifyHeading("!!!")).toBe("section");
  });
});

describe("index helpers", () => {
  const files = [
    parseTranscriptFile(SAMPLE, "/content/transcripts/nonoka/W0bKqP-Eyj4.md"),
    parseTranscriptFile(
      "---\nvideoId: b\n date: 2026-09-01\ntitle: 九月\n---\n## 九月",
      "/content/transcripts/nonoka/b.md",
    ),
  ];

  it("derives index entries", () => {
    const entry = toIndexEntry(files[0]!, "2026-10-29T00:00:00.000Z");
    expect(entry).toMatchObject({
      datasetId: "nonoka",
      videoId: "W0bKqP-Eyj4",
      date: "2026-10-13",
      title: "【ライブ振り返り】13th live をふりかえる",
      updatedAt: "2026-10-29T00:00:00.000Z",
    });
  });

  it("sorts newest first and groups by month", () => {
    const entries = files.map(file => toIndexEntry(file, ""));
    const sorted = sortTranscriptEntries(entries);
    expect(sorted.map(entry => entry.videoId)).toEqual(["W0bKqP-Eyj4", "b"]);

    const groups = groupTranscriptsByMonth(sorted);
    expect(groups.map(group => group.key)).toEqual(["2026-10", "2026-09"]);
    expect(groups[0]?.label).toBe("2026 年 10 月");
  });
});
