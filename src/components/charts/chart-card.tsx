import { Download } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { exportPng, exportSvg, safeFilename } from "@/lib/chart-export";
import { cn } from "@/lib/utils";

interface ChartCardProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

interface ChartExportMenuProps {
  panelRef: RefObject<HTMLDivElement | null>;
  title: string;
}

function ChartExportMenu({ panelRef, title }: ChartExportMenuProps) {
  const handleExport = async (format: "svg" | "png") => {
    const svg = panelRef.current?.querySelector<SVGSVGElement>("svg");
    if (!svg) return;

    const filenameBase = safeFilename(title);

    try {
      if (format === "svg") exportSvg(svg, filenameBase);
      else await exportPng(svg, filenameBase);
    } catch (error) {
      console.error("[chart-export]", error);
    }
  };

  return (
    <Menu>
      <MenuTrigger render={<Button aria-label="导出图表" size="icon-xs" variant="ghost" />}>
        <Download aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem onClick={() => void handleExport("svg")}>导出 SVG</MenuItem>
        <MenuItem onClick={() => void handleExport("png")}>导出 PNG</MenuItem>
      </MenuPopup>
    </Menu>
  );
}

export function ChartCard({ title, description, action, children, className }: ChartCardProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [hasChart, setHasChart] = useState(false);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const sync = () => setHasChart(panel.querySelector("svg") !== null);
    const observer = new MutationObserver(sync);

    sync();
    observer.observe(panel, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  const showAction = Boolean(action) || hasChart;

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {showAction ? (
          <CardAction>
            <div className="flex items-center gap-1">
              {action}
              {hasChart ? <ChartExportMenu panelRef={panelRef} title={title} /> : null}
            </div>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardPanel className="pt-0">
        <div ref={panelRef}>{children}</div>
      </CardPanel>
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
