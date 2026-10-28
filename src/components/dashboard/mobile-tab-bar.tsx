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
        className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-background/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="grid grid-cols-4">
          {items.map(item => {
            const Icon = item.icon;
            const active = activeSection === item.key;

            return (
              <li key={item.key}>
                <Link
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-12 flex-col items-center justify-center gap-0.5 py-1 text-caption transition-colors duration-120 ease-out focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-member",
                    active ? "text-member" : "text-muted-foreground",
                  )}
                  to={item.to}
                >
                  {active ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-member"
                    />
                  ) : null}
                  <Icon aria-hidden="true" className="size-[18px]" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              aria-haspopup="dialog"
              className="flex min-h-12 w-full flex-col items-center justify-center gap-0.5 py-1 text-caption text-muted-foreground transition-colors duration-120 ease-out focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-member"
              onClick={() => setMemberOpen(true)}
              type="button"
            >
              <Users aria-hidden="true" className="size-[18px]" />
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
