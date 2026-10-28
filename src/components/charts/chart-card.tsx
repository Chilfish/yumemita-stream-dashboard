import type { ReactNode } from "react";
import { Card, CardAction, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ChartCardProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function ChartCard({ title, description, action, children, className }: ChartCardProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardPanel className="pt-0">{children}</CardPanel>
    </Card>
  );
}

interface EmptyChartProps {
  message: string;
  hint?: string;
  height?: number;
}

export function EmptyChart({ message, hint, height = 220 }: EmptyChartProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-center text-muted-foreground"
      style={{ height }}
    >
      <p className="text-sm font-medium text-foreground">{message}</p>
      {hint ? <p className="max-w-sm text-xs">{hint}</p> : null}
    </div>
  );
}
