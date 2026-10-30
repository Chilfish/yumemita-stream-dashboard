import { ExternalLink, ListTree, RotateCcw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import Markdown, { type Components } from "react-markdown";
import { Link } from "react-router";
import remarkGfm from "remark-gfm";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranscript, useTranscriptAvailability } from "@/hooks/use-transcript";
import { transcriptsPath } from "@/lib/routes";
import {
  type TranscriptFile,
  type TranscriptHeading,
  rewriteTimecodes,
  stripInlineMarkdown,
} from "@/lib/transcripts";
import { cn } from "@/lib/utils";

/** 时间码改写后的链接长这样：`…/watch?v=<id>&t=754s`。 */
const YOUTUBE_TIME_LINK = /^https:\/\/www\.youtube\.com\/watch\?v=[^&]+&t=\d+s$/;

const EMPTY_TOC: TranscriptHeading[] = [];

const BODY_CLASS =
  "mx-auto w-full max-w-[80ch] text-[0.9375rem] leading-[1.75] text-foreground [overflow-wrap:anywhere] md:leading-[1.8]";

function youtubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function scrollToHeading(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  // 路由是 hash 路由，标题锚点不能写进 URL，只能就地滚动。
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}

function TranscriptToc({
  items,
  className,
}: {
  items: TranscriptHeading[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className={cn("flex flex-col gap-1.5 border-s border-hairline ps-3", className)}>
      {items.map(item => (
        <li className={cn("min-w-0", item.depth === 3 && "ps-3")} key={item.id}>
          <button
            className="block w-full text-start text-footnote leading-snug text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink"
            onClick={() => scrollToHeading(item.id)}
            type="button"
          >
            {item.text}
          </button>
        </li>
      ))}
    </ul>
  );
}

interface MarkdownNode {
  position?: { start?: { line?: number } };
}

interface TextProps {
  children?: ReactNode;
}

interface HeadingProps extends TextProps {
  node?: MarkdownNode;
}

interface AnchorProps extends TextProps {
  href?: string;
}

interface CodeProps extends TextProps {
  className?: string;
}

interface CheckboxProps {
  checked?: boolean;
}

/** 标题 id 由行号回填：目录与渲染共用同一份 `extractToc` 结果，避免两套 slug 逻辑。 */
function idForHeading(node: MarkdownNode | undefined, idsByLine: Map<number, string>): string | undefined {
  const line = node?.position?.start?.line;
  return typeof line === "number" ? idsByLine.get(line) : undefined;
}

function useMarkdownComponents(idsByLine: Map<number, string>): Components {
  return useMemo(
    () =>
      ({
        h1: ({ node, children }: HeadingProps) => (
          <h2
            className="mt-8 mb-3 scroll-mt-20 text-title text-foreground first:mt-0"
            id={idForHeading(node, idsByLine)}
          >
            {children}
          </h2>
        ),
        h2: ({ node, children }: HeadingProps) => (
          <h2
            className="mt-8 mb-3 scroll-mt-20 text-title text-foreground first:mt-0"
            id={idForHeading(node, idsByLine)}
          >
            {children}
          </h2>
        ),
        h3: ({ node, children }: HeadingProps) => (
          <h3
            className="mt-6 mb-2 scroll-mt-20 text-headline text-foreground"
            id={idForHeading(node, idsByLine)}
          >
            {children}
          </h3>
        ),
        h4: ({ children }: HeadingProps) => (
          <h4 className="mt-5 mb-1.5 text-headline text-foreground">{children}</h4>
        ),
        h5: ({ children }: HeadingProps) => (
          <h5 className="mt-4 mb-1 text-body font-semibold text-foreground">{children}</h5>
        ),
        h6: ({ children }: HeadingProps) => (
          <h6 className="mt-4 mb-1 text-body font-semibold text-foreground">{children}</h6>
        ),
        p: ({ children }: TextProps) => <p className="my-3">{children}</p>,
        strong: ({ children }: TextProps) => (
          <strong className="font-semibold text-foreground">{children}</strong>
        ),
        em: ({ children }: TextProps) => <em className="italic">{children}</em>,
        del: ({ children }: TextProps) => <del className="text-ink-3">{children}</del>,
        a: ({ href, children }: AnchorProps) => {
          const url = href ?? "";
          const timecode = YOUTUBE_TIME_LINK.test(url);
          const external = /^https?:\/\//.test(url);
          return (
            <a
              className={cn(
                "text-member-ink underline decoration-hairline underline-offset-4 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink",
                timecode &&
                  "me-0.5 inline-flex items-baseline rounded-sm bg-member/10 px-1 font-medium tabular-nums no-underline hover:bg-member/16",
              )}
              href={url}
              rel={external ? "noreferrer" : undefined}
              target={external ? "_blank" : undefined}
            >
              {children}
            </a>
          );
        },
        ul: ({ children }: TextProps) => (
          <ul className="my-3 flex list-disc flex-col gap-1 ps-5">{children}</ul>
        ),
        ol: ({ children }: TextProps) => (
          <ol className="my-3 flex list-decimal flex-col gap-1 ps-5">{children}</ol>
        ),
        li: ({ children }: TextProps) => <li className="ps-0.5 [&>p]:my-0">{children}</li>,
        blockquote: ({ children }: TextProps) => (
          <blockquote className="my-4 border-s-2 border-member-ink/50 bg-muted/30 py-1.5 ps-4 text-muted-foreground">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-6 border-hairline" />,
        code: ({ className, children }: CodeProps) => {
          const block = typeof className === "string" && className.startsWith("language-");
          if (block) return <code className="font-mono text-caption">{children}</code>;
          return (
            <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
              {children}
            </code>
          );
        },
        pre: ({ children }: TextProps) => (
          <pre className="my-4 overflow-x-auto rounded-control border border-hairline bg-muted/40 p-3 font-mono text-caption [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit">
            {children}
          </pre>
        ),
        table: ({ children }: TextProps) => (
          <div className="my-4 overflow-x-auto rounded-control border border-hairline">
            <table className="w-full min-w-max border-collapse text-footnote">{children}</table>
          </div>
        ),
        thead: ({ children }: TextProps) => <thead className="bg-muted/40">{children}</thead>,
        tr: ({ children }: TextProps) => (
          <tr className="border-b border-hairline last:border-b-0">{children}</tr>
        ),
        th: ({ children }: TextProps) => (
          <th className="px-3 py-2 text-start font-semibold text-foreground">{children}</th>
        ),
        td: ({ children }: TextProps) => (
          <td className="px-3 py-2 align-top text-foreground">{children}</td>
        ),
        img: ({ alt, src }: { alt?: string; src?: string }) => (
          <img
            alt={alt ?? ""}
            className="my-4 max-w-full rounded-panel border border-hairline"
            decoding="async"
            loading="lazy"
            src={src}
          />
        ),
        input: ({ checked }: CheckboxProps) => (
          <input
            checked={Boolean(checked)}
            className="me-1.5 align-middle accent-member"
            disabled
            readOnly
            type="checkbox"
          />
        ),
      }) as unknown as Components,
    [idsByLine],
  );
}

function TranscriptSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-3">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-3 w-full max-w-[60ch]" />
      <Skeleton className="h-3 w-full max-w-[64ch]" />
      <Skeleton className="h-3 w-full max-w-[56ch]" />
      <Skeleton className="mt-3 h-4 w-24" />
      <Skeleton className="h-3 w-full max-w-[62ch]" />
      <Skeleton className="h-3 w-full max-w-[48ch]" />
      <span className="sr-only">正在加载逐字稿</span>
    </div>
  );
}

function TranscriptEmpty({ datasetId, videoId }: { datasetId: string; videoId: string }) {
  return (
    <div className="flex flex-col items-start gap-2 py-2">
      <p className="text-body font-medium text-foreground">这场还没有逐字稿</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Button render={<Link to={transcriptsPath(datasetId)} />} size="sm" variant="outline">
          <ListTree aria-hidden="true" />
          逐字稿索引
        </Button>
        <Button
          render={<a href={youtubeUrl(videoId)} rel="noreferrer" target="_blank" />}
          size="sm"
          variant="ghost"
        >
          <ExternalLink aria-hidden="true" />
          在 YouTube 打开
        </Button>
      </div>
    </div>
  );
}

function TranscriptError({
  datasetId,
  error,
  onRetry,
  videoId,
}: {
  datasetId: string;
  error: string | null;
  onRetry: () => void;
  videoId: string;
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <Alert variant="error">
        <TriangleAlert aria-hidden="true" />
        <AlertTitle>逐字稿加载失败</AlertTitle>
        <AlertDescription>{error ?? "未知错误"}</AlertDescription>
      </Alert>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onRetry} size="sm" type="button" variant="outline">
          <RotateCcw aria-hidden="true" />
          重试
        </Button>
        <Button
          render={<a href={youtubeUrl(videoId)} rel="noreferrer" target="_blank" />}
          size="sm"
          variant="outline"
        >
          <ExternalLink aria-hidden="true" />
          在 YouTube 打开
        </Button>
        <Button render={<Link to={transcriptsPath(datasetId)} />} size="sm" variant="ghost">
          逐字稿索引
        </Button>
      </div>
    </div>
  );
}

function TranscriptHeader({ file }: { file: TranscriptFile }) {
  const { summary } = file.frontmatter;
  return (
    <header className="flex flex-col gap-2 border-b border-hairline pb-4">
      {summary ? (
        <p className="text-body text-muted-foreground">
          {stripInlineMarkdown(summary)}
        </p>
      ) : null}
    </header>
  );
}

export interface TranscriptViewProps {
  datasetId: string;
  videoId: string;
  className?: string;
}

export function TranscriptView({ datasetId, videoId, className }: TranscriptViewProps) {
  const { file, status, error, retry } = useTranscript(datasetId, videoId);
  // 远端对象不存在时 R2 的 404 可能不带 CORS 头，fetch 会变成网络错误。
  // 索引说这场没有稿，就按「还没有逐字稿」处理，而不是报错。
  const { hasTranscript, status: indexStatus } = useTranscriptAvailability(datasetId);
  const missing = indexStatus === "ready" && !hasTranscript(videoId);


  const toc = file?.toc ?? EMPTY_TOC;
  const idsByLine = useMemo(
    () => new Map<number, string>((file?.toc ?? EMPTY_TOC).map(item => [item.line, item.id])),
    [file],
  );
  const components = useMarkdownComponents(idsByLine);
  const markdown = useMemo(
    () => (file ? rewriteTimecodes(file.markdown, videoId) : ""),
    [file, videoId],
  );

  if (status === "idle" || status === "loading") return <TranscriptSkeleton />;
  if (status === "empty") return <TranscriptEmpty datasetId={datasetId} videoId={videoId} />;
  if (status === "error" && missing) {
    return <TranscriptEmpty datasetId={datasetId} videoId={videoId} />;
  }
  if (status === "error" || !file) {
    return (
      <TranscriptError datasetId={datasetId} error={error} onRetry={retry} videoId={videoId} />
    );
  }

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <TranscriptHeader file={file} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_13.5rem] xl:gap-10">
        <div className="min-w-0">
          {toc.length > 1 ? (
            <details className="mb-5 rounded-panel border border-hairline px-3 py-2 xl:hidden">
              <summary className="cursor-pointer text-footnote font-medium text-foreground">
                目录（{toc.length} 节）
              </summary>
              <TranscriptToc className="mt-2" items={toc} />
            </details>
          ) : null}

          <article className={BODY_CLASS}>
            <Markdown components={components} remarkPlugins={[remarkGfm]}>
              {markdown}
            </Markdown>
          </article>

          <footer className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline pt-3 text-caption text-ink-3">
            <a
              className="text-member-ink underline decoration-hairline underline-offset-4 hover:decoration-current"
              href={youtubeUrl(videoId)}
              rel="noreferrer"
              target="_blank"
            >
              在 YouTube 观看原片
            </a>
          </footer>
        </div>

        <aside className="hidden xl:block">
          <nav aria-label="逐字稿目录" className="sticky top-16 max-h-[calc(100dvh-6rem)] overflow-y-auto">
            <p className="mb-2 text-caption text-ink-3">目录</p>
            <TranscriptToc items={toc} />
            {toc.length > 0 ? (
              <button
                className="mt-3 text-caption text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink"
                onClick={() => window.scrollTo({ top: 0 })}
                type="button"
              >
                回到顶部
              </button>
            ) : null}
          </nav>
        </aside>
      </div>
    </div>
  );
}
