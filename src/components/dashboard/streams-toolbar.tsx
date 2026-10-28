import { Download, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CONTENT_TYPE_LABELS, CONTENT_TYPES } from "@/lib/classify";
import {
  DEFAULT_TABLE_PARAMS,
  type StreamTypeFilter,
  isStreamTypeFilter,
  type TableParams,
} from "@/lib/table-params";
import { cn } from "@/lib/utils";

interface StreamsToolbarProps {
  params: TableParams;
  onParamsChange: (next: TableParams) => void;
  onExport: () => void;
}

const TYPE_FILTER_OPTIONS: { value: StreamTypeFilter; label: string }[] = [
  { value: "all", label: "全部" },
  ...CONTENT_TYPES.map(key => ({ value: key as StreamTypeFilter, label: CONTENT_TYPE_LABELS[key] })),
];

function isDefaultParams(params: TableParams): boolean {
  return (
    params.q === DEFAULT_TABLE_PARAMS.q &&
    params.type === DEFAULT_TABLE_PARAMS.type &&
    params.sort === DEFAULT_TABLE_PARAMS.sort &&
    params.dir === DEFAULT_TABLE_PARAMS.dir &&
    params.vstats === DEFAULT_TABLE_PARAMS.vstats
  );
}

/**
 * 场次页工具条：无卡片、无边框，只靠间距与字阶分组。
 * 窄屏横向折行，低频筛选收进底部 Sheet，不删除功能。
 */
export function StreamsToolbar({ params, onParamsChange, onExport }: StreamsToolbarProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const dirty = !isDefaultParams(params);
  const panelDirty =
    params.type !== DEFAULT_TABLE_PARAMS.type || params.vstats !== DEFAULT_TABLE_PARAMS.vstats;

  function changeType(next: string[]): void {
    const [first] = next;
    // 再点一次已选中的 chip 会得到空数组，按“全部”处理，避免出现无选中态。
    const value = isStreamTypeFilter(first) ? first : DEFAULT_TABLE_PARAMS.type;
    onParamsChange({ ...params, type: value });
  }

  function resetParams(): void {
    onParamsChange({ ...DEFAULT_TABLE_PARAMS });
  }

  function renderTypeChips(wrap = false) {
    return (
      <ToggleGroup
        aria-label="内容类型"
        className={cn("shrink-0", wrap && "flex-wrap")}
        onValueChange={changeType}
        size="sm"
        value={[params.type]}
      >
        {TYPE_FILTER_OPTIONS.map(option => (
          <ToggleGroupItem
            className="rounded-full px-2.5 text-footnote text-muted-foreground before:rounded-full hover:text-foreground data-pressed:bg-foreground data-pressed:text-background data-pressed:hover:bg-foreground data-pressed:hover:text-background"
            key={option.value}
            value={option.value}
          >
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    );
  }

  function renderVstatsToggle() {
    return (
      <label className="flex min-h-11 shrink-0 items-center gap-2 text-footnote text-muted-foreground md:min-h-0 md:gap-1.5">
        <Checkbox
          checked={params.vstats}
          onCheckedChange={checked => onParamsChange({ ...params, vstats: checked === true })}
        />
        仅有 VSTATS
      </label>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <div className="relative min-w-0 flex-1 sm:max-w-64">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3"
          />
          <Input
            aria-label="搜索直播"
            className="[&>[data-slot=input]]:ps-8"
            onChange={event => onParamsChange({ ...params, q: event.target.value })}
            placeholder="搜索标题 / 日期 / videoId"
            type="search"
            value={params.q}
          />
        </div>

        <div className="hidden items-center gap-2 md:flex">
          {renderTypeChips()}
          {renderVstatsToggle()}
          <Button
            disabled={!dirty}
            onClick={resetParams}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RotateCcw aria-hidden="true" />
            重置
          </Button>
        </div>

        <div className="ms-auto flex shrink-0 items-center gap-1.5">
          <Button
            aria-label={panelDirty ? "筛选（已启用）" : "筛选"}
            className="md:hidden"
            onClick={() => setFiltersOpen(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            <SlidersHorizontal aria-hidden="true" />
            筛选
            {panelDirty ? (
              <span aria-hidden="true" className="size-1.5 rounded-full bg-member" />
            ) : null}
          </Button>
          <Button onClick={onExport} size="sm" type="button" variant="outline">
            <Download aria-hidden="true" />
            导出 CSV
          </Button>
        </div>
      </div>

      <Sheet onOpenChange={setFiltersOpen} open={filtersOpen}>
        <SheetPopup side="bottom">
          <SheetHeader>
            <SheetTitle>筛选</SheetTitle>
            <SheetDescription>筛选与排序状态会写进 URL，可分享。</SheetDescription>
          </SheetHeader>
          <SheetPanel className="pb-[max(--spacing(6),env(safe-area-inset-bottom))]">
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-caption text-muted-foreground">内容类型</p>
                <div className="mt-1.5">{renderTypeChips(true)}</div>
              </div>
              {renderVstatsToggle()}
              <Button
                className="w-full"
                disabled={!dirty}
                onClick={resetParams}
                size="sm"
                type="button"
                variant="outline"
              >
                <RotateCcw aria-hidden="true" />
                重置筛选
              </Button>
            </div>
          </SheetPanel>
        </SheetPopup>
      </Sheet>
    </>
  );
}
