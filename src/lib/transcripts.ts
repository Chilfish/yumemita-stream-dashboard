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

/** 新的在前；没有日期的排最后，再按标题稳定排序。 */
export function sortTranscriptEntries(
  entries: TranscriptIndexEntry[],
): TranscriptIndexEntry[] {
  return [...entries].sort((a, b) => {
    const left = a.date ?? "";
    const right = b.date ?? "";
    if (left !== right) return right.localeCompare(left);
    return a.title.localeCompare(b.title);
  });
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

/** 索引页按月分组，保持传入顺序（先 sortTranscriptEntries 再分组）。 */
export function groupTranscriptsByMonth(
  entries: TranscriptIndexEntry[],
): TranscriptMonthGroup[] {
  const groups: TranscriptMonthGroup[] = [];
  const index = new Map<string, TranscriptMonthGroup>();

  for (const entry of entries) {
    const key = entry.date && entry.date.length >= 7 ? entry.date.slice(0, 7) : "";
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
