import {
  ArrowUpDown,
  Columns3,
  Download,
  MoreHorizontal,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CONTENT_TYPE_LABELS, CONTENT_TYPES } from "@/lib/classify";
import {
  DEFAULT_TABLE_PARAMS,
  OPTIONAL_TABLE_COLUMNS,
  TABLE_SORT_KEYS,
  type OptionalTableColumn,
  type StreamTypeFilter,
  type TableParams,
  type TableSortKey,
  isStreamTypeFilter,
  isTableSortKey,
  sameColumnSet,
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

const COLUMN_LABELS: Record<OptionalTableColumn, string> = {
  type: "类型",
  avg: "平均同接",
  authors: "人数",
  sc: "SC",
  comments: "评论",
  likeRate: "点赞率",
};

const SORT_LABELS: Record<TableSortKey, string> = {
  date: "日期",
  duration: "时长",
  avg: "平均同接",
  max: "峰值同接",
  watch: "视聴时间",
  views: "播放",
  likes: "点赞",
  chat: "弹幕",
  authors: "发言人数",
  sc: "SC",
  comments: "评论",
};

function FilterCount({ count }: { count: number }) {
  return (
    <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-muted px-1 text-caption tabular-nums text-foreground">
      {count}
    </span>
  );
}

function isDefaultParams(params: TableParams): boolean {
  return (
    params.q === DEFAULT_TABLE_PARAMS.q &&
    params.type === DEFAULT_TABLE_PARAMS.type &&
    params.sort === DEFAULT_TABLE_PARAMS.sort &&
    params.dir === DEFAULT_TABLE_PARAMS.dir &&
    params.vstats === DEFAULT_TABLE_PARAMS.vstats &&
    params.member === DEFAULT_TABLE_PARAMS.member &&
    sameColumnSet(params.cols, DEFAULT_TABLE_PARAMS.cols)
  );
}

/**
 * 场次页工具条：无卡片、无边框，只靠间距与字阶分组。
 * 窄屏横向折行，低频筛选收进底部 Sheet，不删除功能。
 */
export function StreamsToolbar({ params, onParamsChange, onExport }: StreamsToolbarProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const dirty = !isDefaultParams(params);
  const hiddenFilterCount = Number(params.vstats) + Number(params.member);
  // 桌面端的内容类型以 chip 常驻显示，只有收进弹层的条件才计数；
  // 移动端把类型也收进 Sheet，所以计数里要带上它。
  const panelFilterCount =
    hiddenFilterCount + Number(params.type !== DEFAULT_TABLE_PARAMS.type);

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
      <label className="flex min-h-11 shrink-0 items-center gap-2 py-1 text-footnote text-muted-foreground md:min-h-0 md:gap-1.5">
        <Checkbox
          checked={params.vstats}
          onCheckedChange={checked => onParamsChange({ ...params, vstats: checked === true })}
        />
        仅有同接数据
      </label>
    );
  }

  function renderMemberToggle() {
    return (
      <label className="flex min-h-11 shrink-0 items-center gap-2 py-1 text-footnote text-muted-foreground md:min-h-0 md:gap-1.5">
        <Checkbox
          checked={params.member}
          onCheckedChange={checked => onParamsChange({ ...params, member: checked === true })}
        />
        仅有会员
      </label>
    );
  }

  function renderFilterPopover() {
    return (
      <Popover>
        <PopoverTrigger
          render={
            <Button className="hidden md:inline-flex" size="sm" type="button" variant="ghost">
              <SlidersHorizontal aria-hidden="true" />
              筛选
              {hiddenFilterCount > 0 ? <FilterCount count={hiddenFilterCount} /> : null}
            </Button>
          }
        />
        <PopoverPopup align="start" aria-label="筛选">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              {renderVstatsToggle()}
              {renderMemberToggle()}
            </div>
            <Button
              className="w-full"
              disabled={!dirty}
              onClick={resetParams}
              size="sm"
              type="button"
              variant="ghost"
            >
              <RotateCcw aria-hidden="true" />
              重置筛选
            </Button>
          </div>
        </PopoverPopup>
      </Popover>
    );
  }

  function toggleColumn(key: OptionalTableColumn, enabled: boolean): void {
    const next = enabled ? [...params.cols, key] : params.cols.filter(item => item !== key);
    onParamsChange({
      ...params,
      cols: OPTIONAL_TABLE_COLUMNS.filter(item => next.includes(item)),
    });
  }

  function renderColumnsMenu() {
    return (
      <Menu>
        <MenuTrigger
          render={
            <Button className="hidden md:inline-flex" size="sm" type="button" variant="outline">
              <Columns3 aria-hidden="true" />
              列
            </Button>
          }
        />
        <MenuPopup align="end">
          <MenuGroup>
            <MenuGroupLabel>显示列</MenuGroupLabel>
            {OPTIONAL_TABLE_COLUMNS.map(key => (
              <MenuCheckboxItem
                checked={params.cols.includes(key)}
                key={key}
                onCheckedChange={checked => toggleColumn(key, checked === true)}
              >
                {COLUMN_LABELS[key]}
              </MenuCheckboxItem>
            ))}
          </MenuGroup>
        </MenuPopup>
      </Menu>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <div className="min-w-0 flex-1 basis-full sm:basis-0 sm:max-w-64">
          <InputGroup>
            <InputGroupInput
              aria-label="搜索直播"
              onChange={event => onParamsChange({ ...params, q: event.target.value })}
              placeholder="搜索标题或日期"
              type="search"
              value={params.q}
            />
            <InputGroupAddon align="inline-end">
              <Search aria-hidden="true" />
            </InputGroupAddon>
          </InputGroup>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          {renderTypeChips()}
          {renderFilterPopover()}
        </div>

        <div className="ms-auto flex shrink-0 items-center gap-1.5">
          <Menu>
            <MenuTrigger
              render={
                <Button className="md:hidden" size="sm" type="button" variant="outline">
                  <ArrowUpDown aria-hidden="true" />
                  排序
                </Button>
              }
            />
            <MenuPopup align="end">
              <MenuRadioGroup
                onValueChange={value => {
                  if (isTableSortKey(value)) onParamsChange({ ...params, sort: value });
                }}
                value={params.sort}
              >
                {TABLE_SORT_KEYS.map(key => (
                  <MenuRadioItem key={key} value={key}>
                    {SORT_LABELS[key]}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
              <MenuSeparator />
              <MenuItem
                onClick={() =>
                  onParamsChange({ ...params, dir: params.dir === "asc" ? "desc" : "asc" })
                }
              >
                {params.dir === "asc" ? "改为降序" : "改为升序"}
              </MenuItem>
            </MenuPopup>
          </Menu>

          <Button
            aria-label={panelFilterCount > 0 ? `筛选（${panelFilterCount} 项已启用）` : "筛选"}
            className="md:hidden"
            onClick={() => setFiltersOpen(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            <SlidersHorizontal aria-hidden="true" />
            筛选
            {panelFilterCount > 0 ? <FilterCount count={panelFilterCount} /> : null}
          </Button>
          {renderColumnsMenu()}
          <Menu>
            <MenuTrigger
              render={
                <Button aria-label="更多操作" size="icon-sm" type="button" variant="outline">
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              }
            />
            <MenuPopup align="end">
              <MenuItem onClick={onExport}>
                <Download aria-hidden="true" />
                导出 CSV
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>

      <Sheet onOpenChange={setFiltersOpen} open={filtersOpen}>
        <SheetPopup side="bottom">
          <SheetHeader>
            <SheetTitle>筛选</SheetTitle>
          </SheetHeader>
          <SheetPanel className="pb-[max(--spacing(6),env(safe-area-inset-bottom))]">
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-caption text-muted-foreground">内容类型</p>
                <div className="mt-1.5">{renderTypeChips(true)}</div>
              </div>
              {renderVstatsToggle()}
              {renderMemberToggle()}
              <div>
                <p className="text-caption text-muted-foreground">显示列</p>
                <div className="mt-1.5 grid grid-cols-2 gap-4">
                  {OPTIONAL_TABLE_COLUMNS.map(key => (
                    <label
                      className="flex min-h-11 items-center gap-2 text-footnote text-muted-foreground"
                      key={key}
                    >
                      <Checkbox
                        checked={params.cols.includes(key)}
                        onCheckedChange={checked => toggleColumn(key, checked === true)}
                      />
                      {COLUMN_LABELS[key]}
                    </label>
                  ))}
                </div>
              </div>
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
