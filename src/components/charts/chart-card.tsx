import { Download } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { ChartFrame } from "@/components/charts/chart-frame";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { exportPng, exportSvg, safeFilename } from "@/lib/chart-export";

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

  const actions =
    action || hasChart ? (
      <>
        {action}
        {hasChart ? <ChartExportMenu panelRef={panelRef} title={title} /> : null}
      </>
    ) : undefined;

  return (
    <ChartFrame action={actions} className={className} meta={description} title={title}>
      <div ref={panelRef}>{children}</div>
    </ChartFrame>
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
      className="flex flex-col items-center justify-center gap-1 px-4 text-center"
      style={{ height }}
    >
      <p className="text-footnote text-muted-foreground">{message}</p>
      {hint ? <p className="max-w-sm text-caption text-ink-3">{hint}</p> : null}
    </div>
  );
}
