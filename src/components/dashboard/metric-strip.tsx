import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface MetricItem {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: string;
}

interface MetricStripProps {
  items: MetricItem[];
  columns?: 3 | 4 | 6;
  className?: string;
  highlight?: boolean;
}

const COLUMN_CLASS = {
  3: "grid-cols-3",
  4: "grid-cols-2 md:grid-cols-4",
  6: "grid-cols-2 md:grid-cols-3 xl:grid-cols-6",
} as const satisfies Record<3 | 4 | 6, string>;

export function MetricStrip({ items, columns = 6, className, highlight }: MetricStripProps) {
  return (
    <div className={cn("grid", COLUMN_CLASS[columns], className)}>
      {items.map((item, index) => {
        const emphasized = highlight === true && index === 0;

        return (
          <div
            className={cn(
              "min-w-0",
              index === 0 ? "pe-3" : "border-l border-hairline px-3",
            )}
            key={item.label}
          >
            <p className="truncate text-caption text-muted-foreground">{item.label}</p>
            <p
              className={cn(
                "flex items-baseline font-semibold tabular-nums",
                emphasized ? "text-title" : "text-[18px] leading-[22px]",
              )}
            >
              <span className="min-w-0 truncate">{item.value}</span>
              {item.unit ? (
                <span className="ml-1 shrink-0 text-caption font-medium text-ink-3">
                  {item.unit}
                </span>
              ) : null}
            </p>
            {item.hint ? <p className="mt-0.5 truncate text-caption text-ink-3">{item.hint}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
