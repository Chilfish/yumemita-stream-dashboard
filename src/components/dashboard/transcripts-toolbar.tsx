import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DEFAULT_TRANSCRIPT_PARAMS,
  transcriptFilterCount,
  type TranscriptParams,
} from "@/lib/transcript-params";
import {
  isTranscriptSortOrder,
  type TranscriptSortOrder,
  type TranscriptTagCount,
} from "@/lib/transcripts";

interface TranscriptsToolbarProps {
  params: TranscriptParams;
  onChange: (next: TranscriptParams) => void;
  tags: TranscriptTagCount[];
}

const SORT_OPTIONS: { value: TranscriptSortOrder; label: string }[] = [
  { value: "newest", label: "最新" },
  { value: "oldest", label: "最早" },
  { value: "title", label: "标题" },
];

const SEARCH_DEBOUNCE_MS = 200;

const CHIP_CLASS =
  "min-h-11 rounded-full px-2.5 text-footnote text-muted-foreground before:rounded-full hover:text-foreground data-pressed:bg-foreground data-pressed:text-background data-pressed:hover:bg-foreground data-pressed:hover:text-background md:min-h-6";

function FilterCount({ count }: { count: number }) {
  return (
    <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-muted px-1 text-caption tabular-nums text-foreground">
      {count}
    </span>
  );
}

export function TranscriptsToolbar({ params, onChange, tags }: TranscriptsToolbarProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState(params.q);
  const paramsRef = useRef(params);
  const onChangeRef = useRef(onChange);
  const committedQuery = useRef(params.q);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    paramsRef.current = params;
    onChangeRef.current = onChange;
  }, [onChange, params]);

  useEffect(() => {
    if (params.q === committedQuery.current) return;
    committedQuery.current = params.q;
    setQuery(params.q);
  }, [params.q]);

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  const filterCount = transcriptFilterCount(params);
  const dirty = params.q.trim().length > 0 || filterCount > 0;

  function changeParams(patch: Partial<TranscriptParams>): void {
    onChange({ ...paramsRef.current, ...patch });
  }

  function changeQuery(value: string): void {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      searchTimer.current = null;
      committedQuery.current = value;
      changeParams({ q: value });
    }, SEARCH_DEBOUNCE_MS);
  }

  function reset(): void {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = null;
    committedQuery.current = DEFAULT_TRANSCRIPT_PARAMS.q;
    setQuery(DEFAULT_TRANSCRIPT_PARAMS.q);
    onChange(DEFAULT_TRANSCRIPT_PARAMS);
  }

  function changeTags(next: string[]): void {
    changeParams({ tags: next });
  }

  function changeSort(next: string[]): void {
    const [value] = next;
    changeParams({
      sort: isTranscriptSortOrder(value) ? value : DEFAULT_TRANSCRIPT_PARAMS.sort,
    });
  }

  function changeDensity(next: string[]): void {
    const [value] = next;
    changeParams({ dense: value === "dense" });
  }

  function renderTagChips() {
    if (tags.length === 0) {
      return <p className="text-footnote text-muted-foreground">还没有标签。</p>;
    }

    return (
      <ToggleGroup
        aria-label="标签筛选，选中多个时要求同时包含"
        className="flex flex-wrap"
        multiple
        onValueChange={changeTags}
        size="sm"
        value={params.tags}
      >
        {tags.map(item => (
          <ToggleGroupItem
            aria-label={`${item.tag}，${item.count} 篇`}
            className={CHIP_CLASS}
            key={item.tag}
            value={item.tag}
          >
            <span className="max-w-40 truncate">{item.tag}</span>
            <span className="text-caption tabular-nums opacity-64">{item.count}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    );
  }

  function renderFilterContent() {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-caption text-muted-foreground">标签</p>
          {renderTagChips()}
        </div>

        <div>
          <p className="mb-1.5 text-caption text-muted-foreground">排序</p>
          <ToggleGroup
            aria-label="排序"
            className="flex-wrap"
            onValueChange={changeSort}
            size="sm"
            value={[params.sort]}
          >
            {SORT_OPTIONS.map(option => (
              <ToggleGroupItem
                className="min-h-11 rounded-full px-3 md:min-h-8"
                key={option.value}
                value={option.value}
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div>
          <p className="mb-1.5 text-caption text-muted-foreground">密度</p>
          <ToggleGroup
            aria-label="密度"
            className="flex-wrap"
            onValueChange={changeDensity}
            size="sm"
            value={[params.dense ? "dense" : "comfortable"]}
          >
            <ToggleGroupItem className="min-h-11 rounded-full px-3 md:min-h-8" value="comfortable">
              舒适
            </ToggleGroupItem>
            <ToggleGroupItem className="min-h-11 rounded-full px-3 md:min-h-8" value="dense">
              紧凑
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <Button
          className="w-full"
          disabled={!dirty}
          onClick={reset}
          size="sm"
          type="button"
          variant="outline"
        >
          <RotateCcw aria-hidden="true" />
          清除筛选
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 md:max-w-80">
          <InputGroup>
            <InputGroupInput
              aria-label="搜索逐字稿"
              onChange={event => changeQuery(event.target.value)}
              placeholder="搜索标题、摘要或标签"
              type="search"
              value={query}
            />
            <InputGroupAddon align="inline-end">
              <Search aria-hidden="true" />
            </InputGroupAddon>
          </InputGroup>
        </div>

        <Popover>
          <PopoverTrigger
            render={
              <Button
                className="hidden shrink-0 md:inline-flex"
                size="sm"
                type="button"
                variant="ghost"
              >
                <SlidersHorizontal aria-hidden="true" />
                筛选
                {filterCount > 0 ? <FilterCount count={filterCount} /> : null}
              </Button>
            }
          />
          <PopoverPopup align="end" aria-label="筛选逐字稿" className="w-80">
            {renderFilterContent()}
          </PopoverPopup>
        </Popover>

        <Button
          aria-label={filterCount > 0 ? `筛选（${filterCount} 项已启用）` : "筛选"}
          className="shrink-0 md:hidden"
          onClick={() => setFilterOpen(true)}
          size="sm"
          type="button"
          variant="outline"
        >
          <SlidersHorizontal aria-hidden="true" />
          筛选
          {filterCount > 0 ? <FilterCount count={filterCount} /> : null}
        </Button>
      </div>

      <Sheet onOpenChange={setFilterOpen} open={filterOpen}>
        <SheetPopup side="bottom">
          <SheetHeader>
            <SheetTitle>筛选逐字稿</SheetTitle>
          </SheetHeader>
          <SheetPanel className="pb-[max(--spacing(6),env(safe-area-inset-bottom))]">
            {renderFilterContent()}
          </SheetPanel>
        </SheetPopup>
      </Sheet>
    </>
  );
}
