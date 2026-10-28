import { Badge } from "@/components/ui/badge";
import type { StreamRow } from "@/lib/aggregate";
import { formatInteger } from "@/lib/format";

interface StreamCommentsPanelProps {
  row: StreamRow;
}

export function StreamCommentsPanel({ row }: StreamCommentsPanelProps) {
  const comments = row.pack.comments;

  if (!comments || comments.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 py-10 text-center">
        <p className="text-headline text-foreground">本场没有抓取到评论</p>
        <p className="max-w-md text-footnote text-muted-foreground">
          评论区可能在抓取时未开放、已关闭，或抓取时点之后才有评论；弹幕与付费数据不受影响。
        </p>
        {comments ? (
          <p className="text-caption text-ink-3">
            数据包记录评论数 {formatInteger(comments.total)}，但没有可展示的条目。
          </p>
        ) : null}
      </div>
    );
  }

  const { items, pinned, replies, topLevel, total, totalLikes } = comments;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-headline text-foreground">评论区 · {formatInteger(items.length)} 条</h2>
        <p className="text-caption text-ink-3">
          置顶 {formatInteger(pinned)} · 合计赞 {formatInteger(totalLikes)}
        </p>
      </div>

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
              {comment.text}
            </p>
          </li>
        ))}
      </ul>

      <p className="border-t border-hairline pt-2 text-caption text-ink-3">
        抓取到 {formatInteger(total)} 条（一级 {formatInteger(topLevel)} · 回复{" "}
        {formatInteger(replies)}）；置顶 {formatInteger(pinned)}；数据包内全部{" "}
        {formatInteger(items.length)} 条条目已在上面列出。
      </p>
    </div>
  );
}
