import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ChartFrameProps {
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function ChartFrame({ title, meta, action, note, children, className }: ChartFrameProps) {
  return (
    <figure className={cn("flex min-w-0 flex-col gap-2", className)}>
      <figcaption className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-headline text-foreground">{title}</p>
          {meta ? <p className="mt-0.5 text-caption text-muted-foreground">{meta}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
      </figcaption>

      <div className="min-w-0">{children}</div>

      {note ? (
        <p className="border-t border-hairline pt-2 text-caption text-ink-3">{note}</p>
      ) : null}
    </figure>
  );
}
