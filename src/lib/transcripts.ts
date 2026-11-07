/**
 * 逐字稿的解析与派生：frontmatter、目录、时间戳改写。
 *
 * 这个模块必须保持**纯函数、零构建工具依赖**：浏览器的 glob 兜底、hooks 与
 * `scripts/` 下的导入 / 发布脚本共用同一份实现，避免浏览器和脚本各写一套解析后漂移。
 * 因此这里不出现 `import.meta.glob`、`node:` 之类只有一端才有的 API。
 */

export const TRANSCRIPT_INDEX_SCHEMA = "yumemita.transcripts/v1";
export const TRANSCRIPT_SCHEMA = "yumemita.transcript/v1";

/** 对象存储里的索引 key；正文 key 是 `<datasetId>/transcripts/<videoId>.json`。 */
export const TRANSCRIPT_INDEX_KEY = "transcripts/index.json";

export function transcriptObjectKey(datasetId: string, videoId: string): string {
  return `${datasetId}/transcripts/${encodeURIComponent(videoId)}.json`;
}

export type FrontmatterValue = string | number | string[];

/** 允许出现在 frontmatter 里的字段；其余字段解析时忽略。 */
export interface TranscriptFrontmatter {
  videoId: string;
  date: string | null;
  title: string | null;
  members: string[];
  tags: string[];
  summary: string | null;
  tweets: string[];
}

export interface TranscriptHeading {
  id: string;
  text: string;
  depth: 2 | 3;
  /** 标题在正文里的行号（1 起）。渲染时用它把锚点 id 回填到对应标题。 */
  line: number;
}

export interface TranscriptFile {
  datasetId: string;
  videoId: string;
  frontmatter: TranscriptFrontmatter;
  /** 去掉 frontmatter 后的 Markdown 正文（时间戳仍是原始写法）。 */
  markdown: string;
  toc: TranscriptHeading[];
}

export interface TranscriptIndexEntry {
  datasetId: string;
  videoId: string;
  date: string | null;
  title: string;
  tags: string[];
  summary: string | null;
  updatedAt: string;
}

export interface TranscriptIndexFile {
  schema: string;
  generatedAt: string;
  entries: TranscriptIndexEntry[];
}

export interface TranscriptPayload {
  schema: string;
  datasetId: string;
  videoId: string;
  frontmatter: TranscriptFrontmatter;
  markdown: string;
  updatedAt: string;
}

const FRONTMATTER_FENCE = /^---[ \t]*$/;
const FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})/;
const HEADING_LINE = /^(#{2,3})[ \t]+(.+?)[ \t]*$/;
/** 行首时间码：`[12:34]` / `[1:02:03]` / `[00:12:34]`，允许缩进、列表符号、引用符号。 */
const TIMECODE_LINE = /^([ \t]*(?:[-*+][ \t]+|>[ \t]?)?)\[(\d{1,2}:\d{2}(?::\d{2})?)\](?!\()/;

// ---------------------------------------------------------------------------
// frontmatter
// ---------------------------------------------------------------------------

function unescapeDoubleQuoted(value: string): string {
  return value.replace(/\\(["\\])/g, "$1");
}

function parseInlineArray(inner: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;

  const push = (): void => {
    const trimmed = current.trim();
    if (trimmed) items.push(trimmed);
    current = "";
  };

  for (let index = 0; index < inner.length; index += 1) {
    const char = inner.charAt(index);
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ",") {
      push();
      continue;
    }
    current += char;
  }
  push();
  return items;
}

/** 值是字符串、数字、带引号的字符串或 `[a, b]` 行内数组；够用即可，不做完整 YAML。 */
function parseValue(raw: string): FrontmatterValue {
  const text = raw.trim();
  if (text.startsWith("[") && text.endsWith("]")) {
    return parseInlineArray(text.slice(1, -1));
  }
  if (/^"(?:[^"\\]|\\.)*"$/.test(text)) {
    return unescapeDoubleQuoted(text.slice(1, -1));
  }
  if (/^'(?:[^']|'')*'$/.test(text)) {
    return text.slice(1, -1).replaceAll("''", "'");
  }
  if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    return Number(text);
  }
  return text;
}

export interface ParsedFrontmatter {
  data: Record<string, FrontmatterValue>;
  /** frontmatter 之后的正文；没有 frontmatter 时是原文。 */
  body: string;
}

/**
 * 解析 `---` 包裹的极简 frontmatter。不做的事情：多行字符串、块状数组、
 * 嵌套对象、行尾 `#` 注释。这些在作者手写场景里收益低于解析复杂度。
 */
export function parseFrontmatter(text: string): ParsedFrontmatter {
  const source = text.replace(/^\uFEFF/, "");
  const lines = source.split("\n");
  if (!FRONTMATTER_FENCE.test(lines[0] ?? "")) {
    return { data: {}, body: source };
  }

  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (FRONTMATTER_FENCE.test(lines[index] ?? "")) {
      end = index;
      break;
    }
  }
  // 没有闭合的 `---`：当作没有 frontmatter，避免把正文整段吞掉。
  if (end < 0) return { data: {}, body: source };

  const data: Record<string, FrontmatterValue> = {};
  for (let index = 1; index < end; index += 1) {
    const line = (lines[index] ?? "").trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    if (!key) continue;
    data[key] = parseValue(line.slice(colon + 1));
  }

  return { data, body: lines.slice(end + 1).join("\n") };
}

function scalarText(value: FrontmatterValue | undefined): string | null {
  if (value == null) return null;
  const text = Array.isArray(value) ? value.join(", ") : String(value);
  const trimmed = text.trim();
  return trimmed ? trimmed : null;
}

function listValue(value: FrontmatterValue | undefined): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(item => item.trim()).filter(Boolean);
  const text = String(value).trim();
  return text ? [text] : [];
}

export function normalizeFrontmatter(data: Record<string, unknown>): TranscriptFrontmatter {
  const record = data as Record<string, FrontmatterValue | undefined>;
  return {
    videoId: scalarText(record.videoId) ?? "",
    date: scalarText(record.date),
    title: scalarText(record.title),
    members: listValue(record.members),
    tags: listValue(record.tags),
    summary: scalarText(record.summary),
    tweets: listValue(record.tweets),
  };
}

// ---------------------------------------------------------------------------
// 标题 / 目录
// ---------------------------------------------------------------------------

export function slugifyHeading(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[\s\u3000]+/gu, "-")
    .replace(/[^\p{L}\p{N}\-_]/gu, "")
    .replace(/-{2,}/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug || "section";
}

/** 去掉行内 Markdown 标记，只留可见文本；摘要、标题这类单行展示用。 */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function uniqueSlug(base: string, used: Map<string, number>): string {
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

/** 从 `h2` / `h3` 生成目录；跳过代码块里的 `#` 行。 */
export function extractToc(markdown: string): TranscriptHeading[] {
  const headings: TranscriptHeading[] = [];
  const used = new Map<string, number>();
  const lines = markdown.split("\n");
  let fence: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fenceMatch = FENCE_OPEN.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? "";
      if (!fence) fence = marker.charAt(0);
      else if (marker.startsWith(fence)) fence = null;
      continue;
    }
    if (fence) continue;

    const match = HEADING_LINE.exec(line);
    if (!match) continue;
    const text = stripInlineMarkdown(match[2] ?? "");
    if (!text) continue;
    const depth = (match[1] ?? "##").length >= 3 ? 3 : 2;
    headings.push({
      id: uniqueSlug(slugifyHeading(text), used),
      text,
      depth,
      line: index + 1,
    });
  }

  return headings;
}

// ---------------------------------------------------------------------------
// 仅归档的段落
// ---------------------------------------------------------------------------

const ARCHIVE_BLOCK_START = /^[ \t]*<!--\s*archive-only:start\s*-->[ \t]*$/;
const ARCHIVE_BLOCK_END = /^[ \t]*<!--\s*archive-only:end\s*-->[ \t]*$/;
/** 没写标记时的兜底：整节 `## 与既有档案的互证` 直到下一个一级/二级标题。 */
const ARCHIVE_SECTION_HEADING = /^##[ \t]+与既有档案的互证[ \t]*$/;
const TOP_LEVEL_HEADING = /^#{1,2}[ \t]/;

/**
 * 去掉稿件里只供归档的段落：`<!-- archive-only:start -->` 与
 * `<!-- archive-only:end -->` 之间，以及没加标记时的「与既有档案的互证」整节。
 *
 * 删除后会压平多余空行、去掉重复的 `---` 分隔线，让正文直接接上附录。
 */
export function stripArchiveBlock(markdown: string): string {
  const lines = markdown.split("\n");
  const kept: string[] = [];
  let mode: "none" | "block" | "section" = "none";

  for (const line of lines) {
    if (mode === "none") {
      if (ARCHIVE_BLOCK_START.test(line)) {
        mode = "block";
        continue;
      }
      if (ARCHIVE_SECTION_HEADING.test(line)) {
        mode = "section";
        continue;
      }
      kept.push(line);
      continue;
    }
    if (mode === "block") {
      if (ARCHIVE_BLOCK_END.test(line)) mode = "none";
      continue;
    }
    if (TOP_LEVEL_HEADING.test(line)) {
      mode = "none";
      kept.push(line);
    }
  }

  const collapsed: string[] = [];
  for (const line of kept) {
    const previous = collapsed[collapsed.length - 1];
    if (line.trim() === "" && previous !== undefined && previous.trim() === "") continue;
    collapsed.push(line);
  }

  const deduped = collapsed.filter((line, index) => {
    if (line.trim() !== "---") return true;
    let previous = index - 1;
    while (previous >= 0 && collapsed[previous]?.trim() === "") previous -= 1;
    return collapsed[previous]?.trim() !== "---";
  });

  while (deduped.length > 0 && (deduped[0] ?? "").trim() === "") deduped.shift();
  while (deduped.length > 0 && (deduped[deduped.length - 1] ?? "").trim() === "") deduped.pop();
  return deduped.join("\n");
}

// ---------------------------------------------------------------------------
// 时间码
// ---------------------------------------------------------------------------

export function timecodeSeconds(timecode: string): number {
  const parts = timecode.split(":").map(part => Number(part));
  if (parts.some(part => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function youtubeTimeUrl(videoId: string, seconds: number): string {
  const offset = Math.max(0, Math.round(seconds));
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${offset}s`;
}

/**
 * 把行首的 `[12:34]` / `[00:12:34]` 改写成指向原视频对应秒数的链接。
 * 括号本身变成链接，可见文本仍是原始时间码；代码块内的行不动。
 * 行数保持不变，所以目录里的行号在改写前后仍然对得上。
 */
export function rewriteTimecodes(markdown: string, videoId: string): string {
  if (!videoId) return markdown;
  let fence: string | null = null;

  return markdown
    .split("\n")
    .map(line => {
      const fenceMatch = FENCE_OPEN.exec(line);
      if (fenceMatch) {
        const marker = fenceMatch[1] ?? "";
        if (!fence) fence = marker.charAt(0);
        else if (marker.startsWith(fence)) fence = null;
        return line;
      }
      if (fence) return line;

      const match = TIMECODE_LINE.exec(line);
      if (!match) return line;
      const prefix = match[1] ?? "";
      const timecode = match[2] ?? "";
      const rest = line.slice(match[0].length);
      return `${prefix}[${timecode}](${youtubeTimeUrl(videoId, timecodeSeconds(timecode))})${rest}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// 文件
// ---------------------------------------------------------------------------

/** `content/transcripts/<datasetId>/<videoId>.md` → `datasetId`；根目录文件返回空串。 */
function datasetIdFromPath(filename: string): string {
  const segments = filename.split(/[\\/]+/).filter(Boolean);
  segments.pop();
  if (segments.length === 0) return "";
  const marker = segments.lastIndexOf("transcripts");
  const datasetId = segments[segments.length - 1] ?? "";
  if (marker >= 0) return marker === segments.length - 1 ? "" : datasetId;
  return datasetId;
}

/**
 * 解析一篇逐字稿。`filename` 只用来推断 datasetId，
 * 真正的关联键始终是 frontmatter 里的 `videoId`。
 */
export function parseTranscriptFile(text: string, filename: string): TranscriptFile {
  const { data, body } = parseFrontmatter(text);
  const frontmatter = normalizeFrontmatter(data);
  if (!frontmatter.videoId) {
    throw new Error(`${filename}：frontmatter 缺少必填字段 videoId`);
  }
  const markdown = body.replace(/^\n+/, "").trimEnd();
  return {
    datasetId: datasetIdFromPath(filename),
    videoId: frontmatter.videoId,
    frontmatter,
    markdown,
    toc: extractToc(markdown),
  };
}

/** 由解析结果派生索引条目（`updatedAt` 由调用方给：文件 mtime 或发布时间）。 */
export function toIndexEntry(file: TranscriptFile, updatedAt: string): TranscriptIndexEntry {
  return {
    datasetId: file.datasetId,
    videoId: file.videoId,
    date: file.frontmatter.date,
    title: file.frontmatter.title ?? file.videoId,
    tags: file.frontmatter.tags,
    summary: file.frontmatter.summary,
    updatedAt,
  };
}

export const TRANSCRIPT_SORT_ORDERS = ["newest", "oldest", "title"] as const;

export type TranscriptSortOrder = (typeof TRANSCRIPT_SORT_ORDERS)[number];

export function isTranscriptSortOrder(value: unknown): value is TranscriptSortOrder {
  return typeof value === "string" && (TRANSCRIPT_SORT_ORDERS as readonly string[]).includes(value);
}

/** 新的在前；没有日期的排最后。`title` 按标题，同日再按日期倒序。 */
export function sortTranscriptEntries(
  entries: TranscriptIndexEntry[],
  order: TranscriptSortOrder = "newest",
): TranscriptIndexEntry[] {
  const byTitle = (a: TranscriptIndexEntry, b: TranscriptIndexEntry): number =>
    a.title.localeCompare(b.title) ||
    (b.date ?? "").localeCompare(a.date ?? "") ||
    a.videoId.localeCompare(b.videoId);

  return [...entries].sort((a, b) => {
    if (order === "title") return byTitle(a, b);

    const left = a.date ?? "";
    const right = b.date ?? "";
    // 缺日期始终排最后，不随升序 / 降序翻转。
    if (!left || !right) {
      if (!left && !right) return byTitle(a, b);
      return left ? -1 : 1;
    }
    if (left !== right) {
      return order === "oldest" ? left.localeCompare(right) : right.localeCompare(left);
    }
    return byTitle(a, b);
  });
}

export interface TranscriptTagCount {
  tag: string;
  count: number;
}

/** 索引页的标签分面：按篇数倒序，同篇数按名称排序。 */
export function collectTranscriptTags(
  entries: TranscriptIndexEntry[],
): TranscriptTagCount[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const tag of entry.tags) {
      const text = tag.trim();
      if (!text) continue;
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function transcriptSearchTokens(query: string): string[] {
  return [...new Set(
    query
      .toLocaleLowerCase()
      .split(/\s+/)
      .map(token => token.trim())
      .filter(Boolean),
  )];
}

function transcriptSearchHaystack(entry: TranscriptIndexEntry): string {
  return [
    entry.title,
    entry.summary ?? "",
    entry.tags.join(" "),
    entry.date ?? "",
    entry.videoId,
  ]
    .join("\n")
    .toLocaleLowerCase();
}

/** 空格分词后要求全部命中；空查询视为通过。 */
export function matchesTranscriptQuery(
  entry: TranscriptIndexEntry,
  query: string,
): boolean {
  const tokens = transcriptSearchTokens(query);
  if (tokens.length === 0) return true;
  const haystack = transcriptSearchHaystack(entry);
  return tokens.every(token => haystack.includes(token));
}

/** 标签之间是「同时包含」，不是「任意一个」。 */
export function filterTranscripts(
  entries: TranscriptIndexEntry[],
  options: { query?: string; tags?: string[] } = {},
): TranscriptIndexEntry[] {
  const query = options.query ?? "";
  const tags = (options.tags ?? []).filter(Boolean);
  return entries.filter(
    entry =>
      tags.every(tag => entry.tags.includes(tag)) &&
      matchesTranscriptQuery(entry, query),
  );
}

/** 摘要截取：优先从命中词附近开始，保留前后文；没有命中时取开头。 */
export function transcriptExcerpt(
  text: string | null,
  query: string,
  maxLength = 90,
): string {
  const source = stripInlineMarkdown(text ?? "").replace(/\s+/g, " ").trim();
  if (!source || source.length <= maxLength) return source;

  const haystack = source.toLocaleLowerCase();
  let hit = -1;
  for (const token of transcriptSearchTokens(query)) {
    const index = haystack.indexOf(token);
    if (index >= 0 && (hit < 0 || index < hit)) hit = index;
  }

  const start = hit < 0 ? 0 : Math.max(0, hit - Math.floor(maxLength / 3));
  const end = Math.min(source.length, start + maxLength);
  return `${start > 0 ? "…" : ""}${source.slice(start, end).trim()}${end < source.length ? "…" : ""}`;
}

export interface TranscriptTextPart {
  text: string;
  match: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 把文本按查询词切成普通段与命中段，供渲染层包 `<mark>`。 */
export function splitTranscriptHighlight(
  text: string,
  query: string,
): TranscriptTextPart[] {
  if (!text) return [];
  const tokens = transcriptSearchTokens(query).sort((a, b) => b.length - a.length);
  if (tokens.length === 0) return [{ text, match: false }];

  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi");
  const parts: TranscriptTextPart[] = [];
  let last = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: text.slice(last, index), match: false });
    parts.push({ text: match[0], match: true });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });

  return parts.length > 0 ? parts : [{ text, match: false }];
}

export interface TranscriptMonthGroup {
  /** `YYYY-MM`；没有日期时是空串。 */
  key: string;
  label: string;
  entries: TranscriptIndexEntry[];
}

function monthLabel(key: string): string {
  if (!key) return "未标注日期";
  const [year, month] = key.split("-");
  const monthNumber = Number(month);
  if (!year || !Number.isFinite(monthNumber) || monthNumber <= 0) return key;
  return `${year} 年 ${monthNumber} 月`;
}

export function transcriptMonthKey(entry: TranscriptIndexEntry): string {
  return entry.date && entry.date.length >= 7 ? entry.date.slice(0, 7) : "";
}

/** 月份导航用的紧凑标签：`2026.11`；没有日期时是 `未标注`。 */
export function transcriptMonthShortLabel(key: string): string {
  if (!key) return "未标注";
  return key.replace("-", ".");
}

/** 索引页按月分组，保持传入顺序（先 sortTranscriptEntries 再分组）。 */
export function groupTranscriptsByMonth(
  entries: TranscriptIndexEntry[],
): TranscriptMonthGroup[] {
  const groups: TranscriptMonthGroup[] = [];
  const index = new Map<string, TranscriptMonthGroup>();

  for (const entry of entries) {
    const key = transcriptMonthKey(entry);
    let group = index.get(key);
    if (!group) {
      group = { key, label: monthLabel(key), entries: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.entries.push(entry);
  }

  return groups;
}
