import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { isXTokenLabel, linkifyX } from "@/lib/x-links";

/**
 * 简介是 YouTube 原生的分行排版（裸链接、全角空格、长装饰线）：
 * 单换行要保留成换行，任何长串都必须能在窄屏内折断。
 */
const DESCRIPTION_COMPONENTS: Components = {
  p: ({ children }) => (
    <p className="my-2 whitespace-pre-line first:mt-0 last:mb-0">{children}</p>
  ),
  strong: ({ children }) => <strong className="font-medium text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => {
    const url = href ?? "";
    const external = /^https?:\/\//.test(url);
    const xToken = isXTokenLabel(typeof children === "string" ? children : "");
    return (
      <a
        className={cn(
          "text-member-ink wrap-anywhere focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink",
          xToken
            ? "font-semibold no-underline hover:underline hover:decoration-current"
            : "underline decoration-hairline underline-offset-2 hover:decoration-current",
        )}
        href={url}
        rel={external ? "noreferrer" : undefined}
        target={external ? "_blank" : undefined}
      >
        {children}
      </a>
    );
  },
  ul: ({ children }) => <ul className="my-2 flex list-disc flex-col gap-1 ps-4">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 flex list-decimal flex-col gap-1 ps-4">{children}</ol>,
  li: ({ children }) => (
    <li className="min-w-0 ps-0.5 whitespace-pre-line [&>p]:my-0">{children}</li>
  ),
  hr: () => <hr className="my-3 border-hairline" />,
};

export interface StreamDescriptionProps {
  description: string | null;
  links: string[];
}

export function StreamDescription({ description, links }: StreamDescriptionProps) {
  // 简介通常就包含这些链接；只有简介缺失时才退回用链接清单。
  const markdown = description ? linkifyX(description) : links.map(link => `- ${link}`).join("\n");
  if (!markdown) return null;

  return (
    <div className="text-footnote leading-relaxed text-muted-foreground wrap-anywhere">
      <Markdown components={DESCRIPTION_COMPONENTS} remarkPlugins={[remarkGfm]}>
        {markdown}
      </Markdown>
    </div>
  );
}
