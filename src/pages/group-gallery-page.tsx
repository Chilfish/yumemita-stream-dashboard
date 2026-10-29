import { RotateCcw } from "lucide-react";
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { GalleryView } from "@/components/dashboard/gallery-view";
import { useGroupDataContext } from "@/components/dashboard/group-data-context";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  CONTENT_TYPE_LABELS,
  type ContentTypeKey,
  classifyTitle,
} from "@/lib/classify";
import { formatInteger } from "@/lib/format";
import {
  GALLERY_ALL_MEMBERS,
  GALLERY_TYPE_FILTERS,
  type GalleryParams,
  type GalleryTypeFilter,
  parseGalleryParams,
  parseGalleryType,
  writeGalleryParams,
} from "@/lib/gallery-params";
import { DEFAULT_MEMBER_COLOR } from "@/lib/group";

const CHIP_CLASS =
  "gap-1.5 rounded-full px-2.5 text-footnote text-muted-foreground before:rounded-full hover:text-foreground data-pressed:bg-foreground data-pressed:text-background data-pressed:hover:bg-foreground data-pressed:hover:text-background";

const CHIP_ROW_CLASS = "flex min-w-0 max-w-full flex-wrap gap-1";

const TYPE_OPTIONS: { value: (typeof GALLERY_TYPE_FILTERS)[number]; label: string }[] =
  GALLERY_TYPE_FILTERS.map(value => ({
    value,
    label: value === "all" ? "全部" : CONTENT_TYPE_LABELS[value],
  }));

interface GalleryCounts {
  byMember: Map<string, number>;
  byType: Map<ContentTypeKey, number>;
  memberTotal: number;
  typeTotal: number;
}

function countChips(
  rows: { datasetId: string; title: string }[],
  member: string | null,
  type: GalleryTypeFilter,
): GalleryCounts {
  const byMember = new Map<string, number>();
  const byType = new Map<ContentTypeKey, number>();
  let memberTotal = 0;
  let typeTotal = 0;

  for (const row of rows) {
    const rowType = classifyTitle(row.title).key;
    // 每个 chip 的计数按「另一维筛选已生效」来算，点下去看到的就是这个数。
    if (type === "all" || rowType === type) {
      memberTotal += 1;
      byMember.set(row.datasetId, (byMember.get(row.datasetId) ?? 0) + 1);
    }
    if (member === null || row.datasetId === member) {
      typeTotal += 1;
      byType.set(rowType, (byType.get(rowType) ?? 0) + 1);
    }
  }

  return { byMember, byType, memberTotal, typeTotal };
}

/**
 * 全组相册：所有成员的场次混在一条时间线上，按 JST 自然月分组。
 * 成员 / 内容类型筛选写进 URL（默认值不写），可分享、可回退。
 */
export function GroupGalleryPage() {
  const { rows, members, totals } = useGroupDataContext();
  const [searchParams, setSearchParams] = useSearchParams();

  const memberIds = useMemo(() => members.map(member => member.dataset.id), [members]);
  const params = parseGalleryParams(searchParams, memberIds);
  const { member, type } = params;

  const visibleRows = useMemo(
    () =>
      rows.filter(
        row =>
          (member === null || row.datasetId === member) &&
          (type === "all" || classifyTitle(row.title).key === type),
      ),
    [rows, member, type],
  );

  const counts = useMemo(() => countChips(rows, member, type), [rows, member, type]);

  function updateParams(patch: Partial<GalleryParams>): void {
    // 筛选不进历史记录，默认值也不写进 URL。
    setSearchParams(writeGalleryParams(searchParams, { ...params, ...patch }), { replace: true });
  }

  function changeMember(next: string[]): void {
    const [value] = next;
    // 再点一次已选中的 chip 会得到空数组，按「全部」处理，避免出现无选中态。
    updateParams({ member: value && value !== GALLERY_ALL_MEMBERS ? value : null });
  }

  function changeType(next: string[]): void {
    const [value] = next;
    updateParams({ type: parseGalleryType(value) });
  }

  function resetFilters(): void {
    updateParams({ member: null, type: "all" });
  }

  const memberLabel =
    members.find(item => item.dataset.id === member)?.dataset.label ?? null;
  const typeLabel = type === "all" ? null : CONTENT_TYPE_LABELS[type];
  const activeLabels = [
    memberLabel ? `成员「${memberLabel}」` : null,
    typeLabel ? `类型「${typeLabel}」` : null,
  ].filter((label): label is string => label !== null);
  const hasFilters = activeLabels.length > 0;

  const filters = (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-1.5 md:flex-row md:items-center md:gap-3">
        <p className="shrink-0 text-caption text-ink-3">成员</p>
        <ToggleGroup
          aria-label="按成员筛选"
          className={CHIP_ROW_CLASS}
          onValueChange={changeMember}
          size="sm"
          value={[member ?? GALLERY_ALL_MEMBERS]}
        >
          <ToggleGroupItem
            aria-label={`全部成员 · ${formatInteger(counts.memberTotal)} 场`}
            className={CHIP_CLASS}
            value={GALLERY_ALL_MEMBERS}
          >
            全部
            <span className="tabular-nums">· {formatInteger(counts.memberTotal)}</span>
          </ToggleGroupItem>
          {members.map(item => {
            const color = item.dataset.color ?? DEFAULT_MEMBER_COLOR;
            const count = counts.byMember.get(item.dataset.id) ?? 0;

            return (
              <ToggleGroupItem
                aria-label={`成员：${item.dataset.label} · ${formatInteger(count)} 场`}
                className={CHIP_CLASS}
                key={item.dataset.id}
                value={item.dataset.id}
              >
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {item.dataset.label}
                <span className="tabular-nums">· {formatInteger(count)}</span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5 md:flex-row md:items-center md:gap-3">
        <p className="shrink-0 text-caption text-ink-3">类型</p>
        <ToggleGroup
          aria-label="按内容类型筛选"
          className={CHIP_ROW_CLASS}
          onValueChange={changeType}
          size="sm"
          value={[type]}
        >
          {TYPE_OPTIONS.map(option => {
            const count =
              option.value === "all"
                ? counts.typeTotal
                : (counts.byType.get(option.value) ?? 0);

            return (
              <ToggleGroupItem
                aria-label={`内容类型：${option.label} · ${formatInteger(count)} 场`}
                className={CHIP_CLASS}
                key={option.value}
                value={option.value}
              >
                {option.label}
                <span className="tabular-nums">· {formatInteger(count)}</span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </div>
    </div>
  );

  const emptyState = hasFilters ? (
    <div className="flex flex-col gap-3 rounded-panel bg-card px-4 py-8 shadow-surface">
      <div className="flex flex-col gap-1">
        <p className="text-body text-foreground">
          没有符合{activeLabels.join("、")}的场次。
        </p>
        <p className="text-footnote text-muted-foreground">
          当前筛选：{activeLabels.join(" · ")}
          。放宽条件或清除筛选，封面就会重新按 JST 自然月排上来。
        </p>
      </div>
      <Button className="self-start" onClick={resetFilters} size="sm" variant="outline">
        <RotateCcw aria-hidden="true" />
        清除筛选
      </Button>
    </div>
  ) : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        eyebrow={`${formatInteger(members.length)} 名成员 · ${formatInteger(totals.streamCount)} 场`}
        title="全组相册"
      />
      <GalleryView emptyState={emptyState} filters={filters} rows={visibleRows} showMember />
    </div>
  );
}
