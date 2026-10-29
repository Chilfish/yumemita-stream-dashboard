import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Fact {
  value: ReactNode;
  label: string;
}

interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  facts?: Fact[];
  actions?: ReactNode;
  className?: string;
  /** 覆盖标题字阶：默认 `text-display`；单场详情用 `text-title`。 */
  titleClassName?: string;
  children?: ReactNode;
}

export function PageHeader({
  eyebrow,
  title,
  facts,
  actions,
  className,
  titleClassName,
  children,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="text-caption text-member-ink">{eyebrow}</p> : null}
        <h1 className={cn("tabular-nums text-foreground", titleClassName ?? "text-display")}>
          {title}
        </h1>
        {facts && facts.length > 0 ? (
          <ul className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-footnote">
            {facts.map((fact, index) => (
              <li className="flex items-baseline gap-1" key={`${fact.label}-${index}`}>
                {index > 0 ? (
                  <span aria-hidden="true" className="text-ink-3">
                    ·
                  </span>
                ) : null}
                <span className="font-semibold tabular-nums text-foreground">{fact.value}</span>
                <span className="text-muted-foreground">{fact.label}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {children ? <div className="mt-1 text-footnote text-muted-foreground">{children}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
