import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface DeltaProps {
  value: number | null;
  compareLabel: string;
  invert?: boolean;
  className?: string;
}

function formatMagnitude(value: number): string {
  const digits = Math.abs(value) >= 100 ? 0 : 1;
  return Math.abs(value).toFixed(digits).replace(/\.0$/, "");
}

export function Delta({ value, compareLabel, invert, className }: DeltaProps) {
  if (value === null || !Number.isFinite(value)) {
    return (
      <span className={cn("inline-flex items-baseline gap-1", className)}>
        <span aria-hidden="true" className="text-footnote font-medium text-muted-foreground">
          —
        </span>
        <span className="text-caption text-muted-foreground">{compareLabel}</span>
      </span>
    );
  }

  const flat = value === 0;
  const improving = invert === true ? value < 0 : value > 0;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <span className={cn("inline-flex items-baseline gap-1", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-0.5 text-footnote font-medium tabular-nums",
          flat ? "text-muted-foreground" : improving ? "text-positive" : "text-destructive",
        )}
      >
        <Icon aria-hidden="true" className="size-3.5 shrink-0 self-center" />
        {`${value > 0 ? "+" : value < 0 ? "-" : ""}${formatMagnitude(value)}%`}
      </span>
      <span className="text-caption text-muted-foreground">{compareLabel}</span>
    </span>
  );
}
