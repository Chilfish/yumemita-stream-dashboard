import { Check } from "lucide-react";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatInteger } from "@/lib/format";
import type { DatasetIndexEntry } from "@/types/dataset";
import { cn } from "@/lib/utils";

const DEFAULT_MEMBER_COLOR = "#b8461f";

interface MemberSheetProps {
  datasets: DatasetIndexEntry[];
  activeId: string;
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
  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetPopup side="bottom">
        <SheetHeader>
          <SheetTitle>成员</SheetTitle>
          <SheetDescription>切换成员会保持当前页面层级。</SheetDescription>
        </SheetHeader>
        <SheetPanel className="pb-[max(--spacing(6),env(safe-area-inset-bottom))]">
          {datasets.length === 0 ? (
            <p className="text-footnote text-muted-foreground">还没有接入成员。</p>
          ) : (
            <ul className="flex flex-col divide-y divide-hairline">
              {datasets.map(member => {
                const active = member.id === activeId;
                const color = member.color ?? DEFAULT_MEMBER_COLOR;

                return (
                  <li key={member.id}>
                    <button
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "flex min-h-12 w-full items-center gap-3 py-2 text-left transition-colors duration-120 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member",
                        active ? "text-foreground" : "text-muted-foreground",
                      )}
                      onClick={() => {
                        onSelect(member);
                        onOpenChange(false);
                      }}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className="flex size-9 shrink-0 items-center justify-center rounded-full text-body text-white"
                        style={{ backgroundColor: color }}
                      >
                        {member.label.slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-foreground">
                          {member.label}
                        </span>
                        <span className="block text-caption text-ink-3 tabular-nums">
                          {formatInteger(member.count)} 场
                        </span>
                      </span>
                      {active ? (
                        <Check aria-hidden="true" className="size-4 shrink-0 text-member" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  );
}
