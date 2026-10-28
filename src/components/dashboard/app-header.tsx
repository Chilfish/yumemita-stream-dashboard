import { Guitar, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DatasetIndexEntry } from "@/types/dataset";
import type { Theme } from "@/hooks/use-theme";

interface AppHeaderProps {
  datasets: DatasetIndexEntry[];
  datasetId: string | null;
  onDatasetChange: (id: string) => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export function AppHeader({
  datasets,
  datasetId,
  onDatasetChange,
  theme,
  onToggleTheme,
}: AppHeaderProps) {
  const items = datasets.map(dataset => ({ value: dataset.id, label: dataset.label }));
  const selected = items.find(item => item.value === datasetId) ?? null;
  const active = datasets.find(dataset => dataset.id === datasetId);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/88 backdrop-blur supports-[backdrop-filter]:bg-background/72">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border bg-muted text-foreground">
            <Guitar aria-hidden="true" className="size-4.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-heading font-semibold text-sm">ゆめみた 配信数据台</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {active ? `${active.label} · ${active.count} 场` : "正在读取数据"}
            </p>
          </div>
        </div>

        <div className="ms-auto flex items-center gap-2">
          {datasets.length > 1 ? (
            <Select
              items={items}
              onValueChange={item => {
                if (item) onDatasetChange(item.value);
              }}
              value={selected}
            >
              <SelectTrigger aria-label="选择数据集" className="h-8 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {items.map(item => (
                  <SelectItem key={item.value} value={item}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null}
          <Button
            aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
            onClick={onToggleTheme}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </Button>
        </div>
      </div>
    </header>
  );
}
