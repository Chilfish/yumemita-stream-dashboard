import { timecodeSeconds, youtubeTimeUrl } from "@/lib/transcripts";

/**
 * 评论文本里的时间码识别。
 *
 * 评论里常见的写法是裸时间码：`7:20 アナタボシ`、`1:09:12 とくべチュ、して`、
 * `41:16 | 43:26 | 48:34`、`0:01-2:35`，点击应跳到原视频对应位置
 * （YouTube 原生行为，形如 `watch?v=<id>&t=266s`）。
 * 简介里的时间码按需求不处理，所以这套只在评论区用。
 */

export type CommentTextSegment =
  | { kind: "text"; text: string }
  | { kind: "timecode"; text: string; url: string };

const URL_TOKEN = /https?:\/\/\S+/gu;
const TIMECODE_TOKEN = /\d{1,2}:\d{2}(?::\d{2})?/gu;

/** 墙钟时间（`午後8:16`）不是视频内偏移。 */
const CLOCK_PREFIX = /(?:午前|午後|上午|下午)$/u;

const DIGIT = /\d/u;
const LATIN_LETTER = /[A-Za-z]/u;

function validTimecode(text: string, start: number, source: string): boolean {
  const before = source.charAt(start - 1);
  const after = source.charAt(start + text.length);
  // 紧贴数字或冒号说明只是长串的一部分（`123:45` 里不该只认 `23:45`）。
  // 前面只挡数字：`:07:19` 这类是表情短码 `:_kuma:` 紧接时间码，属于要识别的写法。
  if (DIGIT.test(before) || DIGIT.test(after) || after === ":") return false;
  // `Q62and1:38:40` 这类字母粘连的写法不是时间码。
  if (LATIN_LETTER.test(before)) return false;
  if (CLOCK_PREFIX.test(source.slice(Math.max(0, start - 2), start))) return false;
  // `12:75` 这类分钟 / 秒越界的写法不是时间码。
  return text
    .split(":")
    .slice(1)
    .every(part => Number(part) < 60);
}

function splitTimecodes(text: string, videoId: string): CommentTextSegment[] {
  const segments: CommentTextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(TIMECODE_TOKEN)) {
    const code = match[0];
    const start = match.index;
    if (!validTimecode(code, start, text)) continue;

    if (start > cursor) segments.push({ kind: "text", text: text.slice(cursor, start) });
    segments.push({ kind: "timecode", text: code, url: youtubeTimeUrl(videoId, timecodeSeconds(code)) });
    cursor = start + code.length;
  }

  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  return segments;
}

/**
 * 把评论文本切成普通文本与时间码片段；`videoId` 缺失时整段按文本返回。
 *
 * 先按 URL 切段：外链里的 `&t=159s` 属于链接本身，不应再被当成本条评论的时间码。
 */
export function splitCommentText(text: string, videoId: string): CommentTextSegment[] {
  if (!text) return [];
  if (!videoId) return [{ kind: "text", text }];

  const segments: CommentTextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_TOKEN)) {
    const start = match.index;
    if (start > cursor) segments.push(...splitTimecodes(text.slice(cursor, start), videoId));
    segments.push({ kind: "text", text: match[0] });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) segments.push(...splitTimecodes(text.slice(cursor), videoId));

  return segments;
}

/** 同样规则输出 Markdown：可见文本仍是原时间码，`.md` 视图里也能跳转。 */
export function linkifyCommentText(text: string, videoId: string): string {
  return splitCommentText(text, videoId)
    .map(segment => (segment.kind === "timecode" ? `[${segment.text}](${segment.url})` : segment.text))
    .join("");
}
