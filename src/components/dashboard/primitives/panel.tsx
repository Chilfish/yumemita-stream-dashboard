import { Children, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface PanelProps {
  className?: string;
  children: ReactNode;
}

/**
 * 面板表面直接用组件库的 Card：圆角、描边、内描边高光都由 UI 层统一，
 * 这里只负责去掉 Card 的纵向 padding，让内容自己贴边。
 */
export function Panel({ className, children }: PanelProps) {
  return <Card className={cn("gap-0 py-0", className)}>{children}</Card>;
}

interface PanelHeadProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PanelHead({ eyebrow, title, meta, actions, className }: PanelHeadProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 px-5 pb-3 pt-4 sm:flex-row sm:items-start sm:justify-between sm:gap-x-3",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="text-caption text-muted-foreground">{eyebrow}</p> : null}
        <h2 className="text-headline text-foreground">{title}</h2>
        {meta ? <p className="mt-0.5 text-caption text-muted-foreground">{meta}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-1">{actions}</div> : null}
    </div>
  );
}

interface PanelBodyProps {
  className?: string;
  flush?: boolean;
  divided?: boolean;
  children: ReactNode;
}

export function PanelBody({ className, flush, divided, children }: PanelBodyProps) {
  return (
    <div
      className={cn(
        "px-5 pb-5",
        divided && "border-t border-hairline",
        flush && "px-0 pb-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface PanelNoteProps {
  className?: string;
  children: ReactNode;
}

export function PanelNote({ className, children }: PanelNoteProps) {
  return (
    <div
      className={cn(
        "border-t border-hairline px-5 py-2.5 text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface SplitPanelProps {
  columns?: "main" | "even";
  className?: string;
  children: ReactNode;
}

export function SplitPanel({ columns = "main", className, children }: SplitPanelProps) {
  return (
    <div
      className={cn(
        "grid divide-x divide-hairline",
        columns === "main" ? "grid-cols-[1.85fr_1fr]" : "grid-cols-2",
        className,
      )}
    >
      {Children.map(children, child =>
        child == null ? null : <div className="min-w-0">{child}</div>,
      )}
    </div>
  );
}
