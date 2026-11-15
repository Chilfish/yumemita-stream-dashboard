import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionCardProps {
  /** 有 `h2` 标题的区块用 `section`；没有标题的用 `div`，避免产生没有名字的 landmark。 */
  as?: "section" | "div";
  className?: string;
  children: ReactNode;
}

/**
 * 列表 / 网格区块的表面：圆角 + 描边，内容自己管分隔线与内边距。
 * 与 `Panel` 分工：`Panel` 走 Card 系列，放分析面板；这里放贴边的长列表。
 */
export function SectionCard({ as: Tag = "section", className, children }: SectionCardProps) {
  return (
    <Tag className={cn("overflow-hidden rounded-xl border border-hairline bg-card", className)}>
      {children}
    </Tag>
  );
}

interface SectionHeadingProps {
  title: ReactNode;
  /** 右侧读数，统一 caption 字阶 + 三级字色。 */
  meta?: ReactNode;
  className?: string;
}

/** 区块内的二级标题：标题在左、读数在右，不单独占一行。 */
export function SectionHeading({ title, meta, className }: SectionHeadingProps) {
  return (
    <div className={cn("flex flex-wrap items-baseline justify-between gap-2", className)}>
      <h2 className="text-headline text-foreground">{title}</h2>
      {meta ? <p className="text-caption text-ink-3">{meta}</p> : null}
    </div>
  );
}
