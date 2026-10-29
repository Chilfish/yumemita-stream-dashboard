import { Activity, LayoutDashboard, Table2, Users } from "lucide-react";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { MemberSheet } from "@/components/dashboard/member-sheet";
import { homePath, streamPath, streamsPath, type ViewKey } from "@/lib/routes";
import type { DatasetIndexEntry } from "@/types/dataset";
import { cn } from "@/lib/utils";

interface MobileTabBarProps {
  datasetId: string;
  datasets: DatasetIndexEntry[];
  activeSection: ViewKey;
  activeMemberId: string;
  latestVideoId: string | null;
  onMemberSelect: (dataset: DatasetIndexEntry) => void;
}

interface TabItem {
  key: ViewKey;
  label: string;
  icon: LucideIcon;
  to: string;
}

/** HIG 标签栏：图标 22、标签 11、条目高 44+，只靠着色标记选中，不加指示条。 */
const ITEM_CLASS =
  "relative flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg py-1 text-[11px] font-medium leading-[15px] transition-colors duration-120 ease-out active:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-member";

export function MobileTabBar({
  datasetId,
  datasets,
  activeSection,
  activeMemberId,
  latestVideoId,
  onMemberSelect,
}: MobileTabBarProps) {
  const [memberOpen, setMemberOpen] = useState(false);

  const items: TabItem[] = [
    { key: "home", label: "首页", icon: LayoutDashboard, to: homePath(datasetId) },
    { key: "streams", label: "场次", icon: Table2, to: streamsPath(datasetId) },
    {
      key: "stream",
      label: "单场",
      icon: Activity,
      to: latestVideoId ? streamPath(datasetId, latestVideoId) : streamsPath(datasetId),
    },
  ];

  return (
    <>
      <nav
        aria-label="主导航"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-card/92 backdrop-blur-xl md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="grid grid-cols-4 gap-1 px-2 py-1.5">
          {items.map(item => {
            const Icon = item.icon;
            const active = activeSection === item.key;

            return (
              <li key={item.key}>
                <Link
                  aria-current={active ? "page" : undefined}
                  className={cn(ITEM_CLASS, active ? "text-member" : "text-muted-foreground")}
                  to={item.to}
                >
                  <Icon aria-hidden="true" className="size-[22px]" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              aria-haspopup="dialog"
              className={cn(ITEM_CLASS, "w-full text-muted-foreground")}
              onClick={() => setMemberOpen(true)}
              type="button"
            >
              <Users aria-hidden="true" className="size-[22px]" />
              <span>成员</span>
            </button>
          </li>
        </ul>
      </nav>

      <MemberSheet
        activeId={activeMemberId}
        datasets={datasets}
        onOpenChange={setMemberOpen}
        onSelect={onMemberSelect}
        open={memberOpen}
      />
    </>
  );
}
