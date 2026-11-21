import { Check, GitCompare } from "lucide-react";
import { Link } from "@/lib/router-compat";
import { groupComparePath } from "@/lib/routes";
import {
  Sheet,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatInteger } from "@/lib/format";
import type { DatasetIndexEntry } from "@/types/dataset";
import { assetUrl, cn } from "@/lib/utils";
import { readableOn } from "@/lib/color";

const DEFAULT_MEMBER_COLOR = "#b8461f";

interface MemberSheetProps {
  datasets: DatasetIndexEntry[];
  /** `null` = 组级页面，没有当前成员。 */
  activeId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (dataset: DatasetIndexEntry) => void;
}

export function MemberSheet({
  datasets,
  activeId,
  open,
  onOpenChange,
  onSelect,
}: MemberSheetProps) {
  const members = datasets.filter(dataset => dataset.kind !== "official");
  const officials = datasets.filter(dataset => dataset.kind === "official");

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetPopup side="bottom">
        <SheetHeader>
          <SheetTitle>成员</SheetTitle>
        </SheetHeader>
        <SheetPanel className="pb-[max(--spacing(6),env(safe-area-inset-bottom))]">
          {members.length === 0 ? (
            <p className="text-footnote text-muted-foreground">还没有成员。</p>
          ) : (
            <ul className="flex flex-col divide-y divide-hairline">
              {members.map(member => {
                const active = member.id === activeId;
                const color = member.color ?? DEFAULT_MEMBER_COLOR;

                return (
                  <li key={member.id}>
                    <button
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "flex min-h-12 w-full items-center gap-3 py-2 text-left transition-colors duration-120 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink",
                        active ? "text-foreground" : "text-muted-foreground",
                      )}
                      onClick={() => {
                        onSelect(member);
                        onOpenChange(false);
                      }}
                      type="button"
                    >
                      {member.avatar ? (
                        <img
                          alt=""
                          aria-hidden="true"
                          className="size-9 shrink-0 rounded-full object-cover"
                          src={assetUrl(member.avatar)}
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="flex size-9 shrink-0 items-center justify-center rounded-full text-body"
                          style={{ backgroundColor: color, color: readableOn(color) }}
                        >
                          {member.label.slice(0, 1)}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-foreground">
                          {member.label}
                        </span>
                        <span className="block text-caption text-ink-3 tabular-nums">
                          {formatInteger(member.count)} 场
                        </span>
                      </span>
                      {active ? (
                        <Check aria-hidden="true" className="size-4 shrink-0 text-member-ink" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {officials.length > 0 ? (
            <div className="mt-3 border-t border-hairline pt-3">
              <p className="px-1 pb-1 text-caption text-ink-3">官方账号</p>
              <ul className="flex flex-col divide-y divide-hairline">
                {officials.map(official => {
                  const active = official.id === activeId;
                  return (
                    <li key={official.id}>
                      <button
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "flex min-h-12 w-full items-center gap-3 py-2 text-left transition-colors duration-120 ease-out",
                          active ? "text-foreground" : "text-muted-foreground",
                        )}
                        onClick={() => {
                          onSelect(official);
                          onOpenChange(false);
                        }}
                        type="button"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body font-medium text-foreground">
                            {official.label}
                          </span>
                          <span className="block text-caption text-ink-3 tabular-nums">
                            {formatInteger(official.count)} 场
                          </span>
                        </span>
                        {active ? (
                          <Check aria-hidden="true" className="size-4 shrink-0 text-member-ink" />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  );
}
