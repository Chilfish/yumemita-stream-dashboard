import { RotateCcw, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { PageHeader } from "@/components/dashboard/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranscriptIndex } from "@/hooks/use-transcript";
import { formatDate, formatInteger } from "@/lib/format";
import { streamPath } from "@/lib/routes";
import {
  groupTranscriptsByMonth,
  stripInlineMarkdown,
  type TranscriptIndexEntry,
} from "@/lib/transcripts";

const COMMANDS: [string, string][] = [
  ["bun run transcript:new <videoId> --dataset nonoka", "从模板建一篇，日期 / 标题自动从 manifest 带出"],
  ['bun run transcript:import "<path>" --dataset nonoka', "把已经写好的 Markdown 复制进 content/transcripts/"],
  ["bun run publish:transcripts", "校验并发布到对象存储；加 --no-upload 只校验"],
];

function EntryRow({ datasetId, entry }: { datasetId: string; entry: TranscriptIndexEntry }) {
  return (
    <li className="border-t border-hairline first:border-t-0">
      <Link
        className="group grid gap-1 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink md:grid-cols-[5.5rem_minmax(0,1fr)] md:gap-4"
        to={streamPath(datasetId, entry.videoId, "transcript")}
      >
        <span className="text-caption text-ink-3 tabular-nums md:pt-1">
          {entry.date ? formatDate(entry.date) : "—"}
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-body font-medium text-foreground transition-colors group-hover:text-member-ink">
            {stripInlineMarkdown(entry.title)}
          </span>
          {entry.summary ? (
            <span className="line-clamp-2 max-w-[70ch] text-footnote text-muted-foreground">
              {stripInlineMarkdown(entry.summary)}
            </span>
          ) : null}
          {entry.tags.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {entry.tags.map(tag => (
                <Badge key={tag} size="sm" variant="outline">
                  {tag}
                </Badge>
              ))}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

function TranscriptsEmpty() {
  return (
    <div className="flex flex-col items-start gap-3 rounded-panel bg-card px-4 py-8 shadow-surface">
      <p className="text-body font-medium text-foreground">还没有逐字稿</p>
      <p className="max-w-[70ch] text-footnote text-muted-foreground">
        逐字稿是作者手动维护的 Markdown，放在{" "}
        <code className="font-mono text-caption">content/transcripts/&lt;datasetId&gt;/&lt;videoId&gt;.md</code>{" "}
        并提交到 git；页面只读渲染，不在站内编辑。
      </p>
      <dl className="flex w-full max-w-[70ch] flex-col divide-y divide-hairline text-footnote">
        {COMMANDS.map(([command, description]) => (
          <div className="grid gap-1 py-2 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)]" key={command}>
            <dt>
              <code className="font-mono text-caption text-foreground">{command}</code>
            </dt>
            <dd className="text-muted-foreground">{description}</dd>
          </div>
        ))}
      </dl>
      <p className="text-caption text-ink-3">
        格式与字段说明见 <code className="font-mono">content/transcripts/README.md</code>。
      </p>
    </div>
  );
}

function TranscriptsSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-3">
      <Skeleton className="h-4 w-28" />
      {Array.from({ length: 5 }, (_, index) => (
        <div className="flex flex-col gap-2 border-t border-hairline pt-3" key={index}>
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-full max-w-[60ch]" />
        </div>
      ))}
      <span className="sr-only">正在加载逐字稿索引</span>
    </div>
  );
}

export interface TranscriptsViewProps {
  datasetId: string;
  datasetLabel?: string;
}

export function TranscriptsView({ datasetId, datasetLabel }: TranscriptsViewProps) {
  const { entries, status, error, source, retry } = useTranscriptIndex(datasetId);
  const groups = useMemo(() => groupTranscriptsByMonth(entries), [entries]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="逐字稿"
        facts={[
          { label: "篇", value: formatInteger(entries.length) },
          { label: "个月", value: formatInteger(groups.length) },
        ]}
        title={datasetLabel ?? "逐字稿索引"}
      />

      {status === "loading" || status === "idle" ? <TranscriptsSkeleton /> : null}

      {status === "error" ? (
        <div className="flex flex-col items-start gap-3">
          <Alert variant="error">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>逐字稿索引加载失败</AlertTitle>
            <AlertDescription>{error ?? "未知错误"}</AlertDescription>
          </Alert>
          <Button onClick={retry} size="sm" type="button" variant="outline">
            <RotateCcw aria-hidden="true" />
            重试
          </Button>
        </div>
      ) : null}

      {status === "ready" && entries.length === 0 ? <TranscriptsEmpty /> : null}

      {status === "ready" && entries.length > 0 ? (
        <>
          {error ? (
            <p className="text-caption text-ink-3">
              远端索引暂时读不到（{error}），下面是构建时的快照。
            </p>
          ) : null}
          <div className="flex flex-col gap-6">
            {groups.map(group => (
              <section className="flex flex-col gap-1" key={group.key || "undated"}>
                <div className="flex items-baseline gap-2">
                  <h2 className="text-headline text-foreground">{group.label}</h2>
                  <span className="text-caption text-ink-3 tabular-nums">
                    {formatInteger(group.entries.length)} 篇
                  </span>
                </div>
                <ul className="flex flex-col">
                  {group.entries.map(entry => (
                    <EntryRow datasetId={datasetId} entry={entry} key={entry.videoId} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <p className="text-caption text-ink-3">
            {source === "remote" ? "索引来自对象存储，发布后刷新即可。" : "索引来自构建快照。"}
          </p>
        </>
      ) : null}
    </div>
  );
}
