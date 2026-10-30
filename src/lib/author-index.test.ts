import { describe, expect, it } from "vitest";
import type { AuthorStat } from "@/types/datapack";
import { AUTHOR_INDEX_SCHEMA, buildAuthorIndex, type AuthorIndexSource } from "./author-index";

function author(authorId: string | null, name: string, messages = 1): AuthorStat {
  return {
    author: name,
    authorId,
    messages,
    superchats: 0,
    stickers: 0,
    memberships: 0,
  };
}

function source(
  videoId: string,
  startedAt: string | null,
  authors: AuthorStat[] | undefined,
): AuthorIndexSource {
  return {
    video: { id: videoId, startedAt },
    chat: authors ? { authors } : {},
  };
}

describe("buildAuthorIndex", () => {
  it("dedupes authors by stable id across streams", () => {
    const index = buildAuthorIndex(
      "nonoka",
      [
        source("a", "2026-10-01T20:00:00+09:00", [author("UC1", "@old"), author("UC2", "@b")]),
        source("b", "2026-10-02T20:00:00+09:00", [author("UC1", "@new")]),
      ],
      "2026-10-30T00:00:00Z",
    );

    expect(index?.schema).toBe(AUTHOR_INDEX_SCHEMA);
    // 按最新场次优先遍历，所以显示名取最近一次抓到的 "@new"。
    expect(index?.authors).toEqual([
      { id: "UC1", name: "@new" },
      { id: "UC2", name: "@b" },
    ]);
    // 最新的场次在前；同一场次内下标升序。
    expect(index?.streams).toEqual([
      { videoId: "b", authors: [0] },
      { videoId: "a", authors: [0, 1] },
    ]);
  });

  it("falls back to display names when an id is missing", () => {
    const index = buildAuthorIndex(
      "nonoka",
      [source("a", "2026-10-01T20:00:00+09:00", [author(null, "@anon")])],
      "2026-10-30T00:00:00Z",
    );

    expect(index?.authors).toEqual([{ id: null, name: "@anon" }]);
    expect(index?.streams).toEqual([{ videoId: "a", authors: [0] }]);
  });

  it("returns null when any stream still uses v1 data", () => {
    const index = buildAuthorIndex(
      "nonoka",
      [
        source("a", "2026-10-01T20:00:00+09:00", [author("UC1", "@a")]),
        source("b", "2026-10-02T20:00:00+09:00", undefined),
      ],
      "2026-10-30T00:00:00Z",
    );

    expect(index).toBeNull();
  });

  it("returns null for an empty dataset", () => {
    expect(buildAuthorIndex("nonoka", [], "2026-10-30T00:00:00Z")).toBeNull();
  });
});
