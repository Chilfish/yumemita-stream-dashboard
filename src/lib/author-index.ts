import type { AuthorStat } from "@/types/datapack";

export const AUTHOR_INDEX_SCHEMA = "yumemita.dashboard.authors/v1";

export interface AuthorIndexEntry {
  /** 稳定的频道 ID；旧数据没有 ID 时为 null。 */
  id: string | null;
  /** 最近一次抓到的显示名。 */
  name: string;
}

export interface AuthorIndexStream {
  videoId: string;
  /** 指向 `authors[]` 的下标。 */
  authors: number[];
}

export interface AuthorIndexFile {
  schema: typeof AUTHOR_INDEX_SCHEMA;
  generatedAt: string;
  datasetId: string;
  authors: AuthorIndexEntry[];
  streams: AuthorIndexStream[];
}

/** 只要求索引需要的字段，方便脚本和测试构造最小输入。 */
export interface AuthorIndexSource {
  video: { id: string; startedAt: string | null };
  chat: { authors?: AuthorStat[] };
}

/**
 * 由 v2 datapack 生成「作者 → 场次」索引，供观众重叠计算使用。
 *
 * 任一场缺 `chat.authors`（v1 数据）时返回 null：宁可不给，也不用半套数据算重叠。
 * 同一作者按稳定 ID 合并；没有 ID 的旧数据退回显示名。
 */
export function buildAuthorIndex(
  datasetId: string,
  packs: AuthorIndexSource[],
  generatedAt: string,
): AuthorIndexFile | null {
  if (packs.length === 0) return null;
  if (packs.some(pack => !pack.chat.authors)) return null;

  const authorIndex = new Map<string, number>();
  const authors: AuthorIndexEntry[] = [];

  const streams = [...packs]
    .sort((a, b) => (b.video.startedAt ?? "").localeCompare(a.video.startedAt ?? ""))
    .map(pack => {
      const seen = new Set<number>();
      for (const author of pack.chat.authors ?? []) {
        const key = author.authorId ? `id:${author.authorId}` : `name:${author.author}`;
        let index = authorIndex.get(key);
        if (index == null) {
          index = authors.length;
          authorIndex.set(key, index);
          authors.push({ id: author.authorId ?? null, name: author.author });
        }
        seen.add(index);
      }
      return {
        videoId: pack.video.id,
        authors: [...seen].sort((a, b) => a - b),
      };
    });

  return { schema: AUTHOR_INDEX_SCHEMA, generatedAt, datasetId, authors, streams };
}
