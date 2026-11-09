import { Link } from "@/lib/router-compat";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { formatInteger } from "@/lib/format";
import { groupHomePath, type GroupViewKey } from "@/lib/routes";

const SECTION_LABELS: Record<GroupViewKey, string> = {
  home: "组首页",
  gallery: "全组相册",
  compare: "全员对比",
  about: "说明",
  calendar: "全组日历",
};

interface GroupHeaderProps {
  section: GroupViewKey;
  memberCount: number;
  streamCount: number;
  /** 日历页不加载全量弹幕统计；null 时只显示人数与场次。 */
  chatTotal: number | null;
}

export function GroupHeader({
  section,
  memberCount,
  streamCount,
  chatTotal,
}: GroupHeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-hairline bg-background px-3 md:px-4">
      <SidebarTrigger className="size-7 text-muted-foreground" />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem>
            <BreadcrumbLink
              className="whitespace-nowrap text-muted-foreground"
              render={<Link to={groupHomePath()} />}
            >
              全组
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage>{SECTION_LABELS[section]}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <p className="ms-auto hidden shrink-0 text-caption text-ink-3 tabular-nums sm:block">
        {formatInteger(memberCount)} 人 · {formatInteger(streamCount)} 场
        {chatTotal != null ? ` · ${formatInteger(chatTotal)} 条弹幕` : ""}
      </p>
    </header>
  );
}

