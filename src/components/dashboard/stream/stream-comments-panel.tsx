import { DataEmpty } from "@/components/dashboard/primitives/data-empty";
import { SectionHeading } from "@/components/dashboard/primitives/section";
import { Badge } from "@/components/ui/badge";
import type { StreamRow } from "@/lib/aggregate";
import { splitCommentText } from "@/lib/comment-text";
import { formatInteger } from "@/lib/format";

interface StreamCommentsPanelProps {
  row: StreamRow;
}

const LINK_CLASS =
  "underline decoration-hairline underline-offset-2 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink";

/**
 * 评论正文：裸时间码跳到原视频对应位置。
 * 简介里的时间码按需求不处理，所以这一套只在评论区用。
 */
function CommentText({ text, videoId }: { text: string; videoId: string }) {
  const segments = splitCommentText(text, videoId);

  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === "timecode" ? (
          <a
            aria-label={`在 YouTube 打开（${segment.text}）`}
            className={`${LINK_CLASS} tabular-nums`}
            href={segment.url}
            key={index}
            rel="noreferrer"
            target="_blank"
          >
            {segment.text}
          </a>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

export function StreamCommentsPanel({ row }: StreamCommentsPanelProps) {
  const comments = row.pack.comments;
  // YouTube 侧的总评论数与抓取上限内的条数口径不同，分别说明。
  const youtubeCount = row.pack.video.snapshot.comments;

  if (!comments || comments.items.length === 0) {
    const platformCount =
      youtubeCount != null && youtubeCount > 0
        ? `YouTube 上有 ${formatInteger(youtubeCount)} 条评论，本站没有抓到条目`
        : "这场没有评论";
    const hint =
      youtubeCount != null && youtubeCount > 0
        ? "抓取按点赞排序取前若干条，可能都落在回复或其他筛选之外。"
        : "评论区没有内容，或不在抓取范围内。";

    return <DataEmpty hint={hint} message={platformCount} />;
  }

  const { items, pinned, total, totalLikes } = comments;
  const videoId = row.summary.videoId;

  return (
    <div className="flex flex-col gap-3">
      <SectionHeading
        meta={
          <>
            置顶 {formatInteger(pinned)} · 合计赞 {formatInteger(totalLikes)}
          </>
        }
        title={<>评论区 · {formatInteger(items.length)} 条</>}
      />

      <ul className="divide-y divide-hairline">
        {items.map((comment, index) => (
          <li
            className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"
            key={`${comment.authorId ?? comment.author ?? "anonymous"}-${index}`}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-footnote font-medium text-foreground">
                {comment.author ?? "（未知账号）"}
              </span>
              <span className="text-caption tabular-nums text-muted-foreground">
                赞 {formatInteger(comment.likes)}
              </span>
              {comment.pinned ? <Badge variant="warning">置顶</Badge> : null}
              {comment.byUploader ? <Badge variant="info">主播</Badge> : null}
            </div>
            <p className="whitespace-pre-wrap text-footnote text-foreground leading-relaxed">
              <CommentText text={comment.text} videoId={videoId} />
            </p>
          </li>
        ))}
      </ul>

      {/* 一级 / 回复的拆分依赖原始回复关系，入库后不可还原，只报抓到的总条数。 */}
      <p className="border-t border-hairline pt-2 text-caption text-ink-3">
        抓取到 {formatInteger(total)} 条 · 置顶 {formatInteger(pinned)}
        {youtubeCount != null && youtubeCount > total
          ? ` · YouTube 共 ${formatInteger(youtubeCount)} 条`
          : ""}
      </p>
    </div>
  );
}
