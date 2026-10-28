import { Download, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CONTENT_TYPE_LABELS, CONTENT_TYPES } from "@/lib/classify";
import {
  DEFAULT_TABLE_PARAMS,
  type StreamTypeFilter,
  isStreamTypeFilter,
  type TableParams,
} from "@/lib/table-params";

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
 * 窄屏横向折行，低频筛选（仅有 VSTATS、重置）排在后面，不删除。
 */
export function StreamsToolbar({ params, onParamsChange, onExport }: StreamsToolbarProps) {
  const dirty = !isDefaultParams(params);

  function changeType(next: string[]): void {
    const [first] = next;
    // 再点一次已选中的 chip 会得到空数组，按“全部”处理，避免出现无选中态。
    const value = isStreamTypeFilter(first) ? first : DEFAULT_TABLE_PARAMS.type;
    onParamsChange({ ...params, type: value });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
      <div className="relative min-w-44 flex-1 sm:max-w-64">
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

      <ToggleGroup
        aria-label="内容类型"
        className="shrink-0"
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

      <label className="flex shrink-0 items-center gap-1.5 text-footnote text-muted-foreground">
        <Checkbox
          checked={params.vstats}
          onCheckedChange={checked => onParamsChange({ ...params, vstats: checked === true })}
        />
        仅有 VSTATS
      </label>

      <div className="ms-auto flex shrink-0 items-center gap-1.5">
        <Button
          disabled={!dirty}
          onClick={() => onParamsChange({ ...DEFAULT_TABLE_PARAMS })}
          size="sm"
          type="button"
          variant="ghost"
        >
          <RotateCcw aria-hidden="true" />
          重置
        </Button>
        <Button onClick={onExport} size="sm" type="button" variant="outline">
          <Download aria-hidden="true" />
          导出 CSV
        </Button>
      </div>
    </div>
  );
}
