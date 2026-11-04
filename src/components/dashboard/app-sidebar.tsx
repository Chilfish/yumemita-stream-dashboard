import {
  CalendarDays,
  FileText,
  GitCompare,
  Images,
  Info,
  LayoutDashboard,
  Moon,
  Sun,
  Table2,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "@/lib/router-compat";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import type { Theme } from "@/types/theme";
import { formatInteger } from "@/lib/format";
import {
  groupAboutPath,
  groupCalendarPath,
  groupComparePath,
  groupGalleryPath,
  groupHomePath,
  homePath,
  viewPath,
  type GroupViewKey,
  type ViewKey,
} from "@/lib/routes";
import type { DatasetIndexEntry } from "@/types/dataset";
import { assetUrl, cn } from "@/lib/utils";
import { readableOn } from "@/lib/color";

const DEFAULT_MEMBER_COLOR = "#b8461f";

interface NavItem {
  key: ViewKey;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { key: "home", label: "首页", icon: LayoutDashboard },
  { key: "streams", label: "场次", icon: Table2 },
  { key: "calendar", label: "日历", icon: CalendarDays },
  { key: "trends", label: "趋势", icon: TrendingUp },
  { key: "compare", label: "对比", icon: GitCompare },
  { key: "gallery", label: "相册", icon: Images },
  { key: "transcripts", label: "逐字稿", icon: FileText },
  { key: "about", label: "说明", icon: Info },
];

interface GroupNavItem {
  key: GroupViewKey;
  label: string;
  icon: LucideIcon;
  to: string;
}

const GROUP_NAV_ITEMS: GroupNavItem[] = [
  { key: "home", label: "组首页", icon: LayoutDashboard, to: groupHomePath() },
  { key: "calendar", label: "全组日历", icon: CalendarDays, to: groupCalendarPath() },
  { key: "gallery", label: "全组相册", icon: Images, to: groupGalleryPath() },
  { key: "compare", label: "全员对比", icon: GitCompare, to: groupComparePath() },
  { key: "about", label: "说明", icon: Info, to: groupAboutPath() },
];

const GROUP_NAV_TARGETS: Record<GroupViewKey, string> = {
  home: groupHomePath(),
  calendar: groupCalendarPath(),
  gallery: groupGalleryPath(),
  compare: groupComparePath(),
  about: groupAboutPath(),
};

const ACTIVE_ITEM_CLASS =
  "relative before:absolute before:inset-y-2 before:-left-2 before:w-[2.5px] before:rounded-full before:bg-transparent data-[active=true]:before:bg-member data-[active=true]:bg-card! data-[active=true]:font-medium data-[active=true]:shadow-sm/5";

interface AppSidebarProps {
  /** 组级页面没有当前成员；此时侧栏只展示组导航。 */
  dataset: DatasetIndexEntry | null;
  section: ViewKey | GroupViewKey;
  datasets: DatasetIndexEntry[];
  /** 日历页不加载全量弹幕统计；null 时改显示场次数。 */
  chatTotal: number | null;
  theme: Theme;
  onToggleTheme: () => void;
}

export function AppSidebar({
  dataset,
  section,
  datasets,
  chatTotal,
  theme,
  onToggleTheme,
}: AppSidebarProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const activeSection: ViewKey | GroupViewKey = section === "stream" ? "streams" : section;

  function isActive(key: ViewKey): boolean {
    if (!dataset) return false;
    if (key === "home") return pathname === homePath(dataset.id);
    const target = viewPath(dataset.id, key);
    return pathname === target || pathname.startsWith(`${target}/`);
  }

  function isGroupActive(key: GroupViewKey): boolean {
    if (dataset) return false;
    return pathname === GROUP_NAV_TARGETS[key];
  }

  function handleMemberSelect(next: DatasetIndexEntry): void {
    if (next.id === dataset?.id) return;
    if (!dataset) {
      navigate(homePath(next.id));
      return;
    }
    const nextSection = section === "home" ? "home" : section;
    navigate(viewPath(next.id, nextSection));
  }

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="ゆめみた 配信数据台"
              render={<Link to={groupHomePath()} />}
            >
              <img
                alt=""
                aria-hidden="true"
                className="size-8 shrink-0 rounded-control object-cover"
                src={assetUrl("/brand-mark.webp")}
              />
              <span className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-semibold text-body">ゆめみた 配信数据台</span>
                <span className="truncate text-caption text-muted-foreground">
                  {dataset
                    ? chatTotal != null
                      ? `${formatInteger(chatTotal)} 条弹幕`
                      : `${formatInteger(dataset.count)} 场`
                    : `${datasets.length} 位成员`}
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>成员</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {datasets.map(member => {
                const color = member.color ?? DEFAULT_MEMBER_COLOR;
                return (
                  <SidebarMenuItem key={member.id}>
                    <SidebarMenuButton
                      className={ACTIVE_ITEM_CLASS}
                      isActive={member.id === dataset?.id}
                      onClick={() => handleMemberSelect(member)}
                      tooltip={member.label}
                      type="button"
                    >
                      {member.avatar ? (
                        <img
                          alt=""
                          aria-hidden="true"
                          className="size-5 shrink-0 rounded-full object-cover"
                          src={assetUrl(member.avatar)}
                        />
                      ) : (
                        <span
                          className="flex size-5 shrink-0 items-center justify-center rounded-full text-[11px]"
                          style={{ backgroundColor: color, color: readableOn(color) }}
                        >
                          {member.label.slice(0, 1)}
                        </span>
                      )}
                      <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
                        <span className="truncate">{member.label}</span>
                        <span className="shrink-0 text-caption text-ink-3">
                          {formatInteger(member.count)}
                        </span>
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              {datasets.length >= 2 ? (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    className={cn(
                      ACTIVE_ITEM_CLASS,
                      !dataset && pathname === groupComparePath() && "font-medium",
                    )}
                    isActive={!dataset && pathname === groupComparePath()}
                    tooltip="全员对比"
                    render={<NavLink to={groupComparePath()} />}
                  >
                    <GitCompare aria-hidden="true" />
                    <span>全员对比</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>浏览</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {dataset
                ? NAV_ITEMS.map(item => {
                    const Icon = item.icon;
                    return (
                      <SidebarMenuItem key={item.key}>
                        <SidebarMenuButton
                          className={cn(ACTIVE_ITEM_CLASS, isActive(item.key) && "font-medium")}
                          isActive={item.key === activeSection}
                          tooltip={item.label}
                          render={<NavLink to={viewPath(dataset.id, item.key)} />}
                        >
                          <Icon aria-hidden="true" />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })
                : GROUP_NAV_ITEMS.map(item => {
                    const Icon = item.icon;
                    return (
                      <SidebarMenuItem key={item.key}>
                        <SidebarMenuButton
                          className={cn(
                            ACTIVE_ITEM_CLASS,
                            isGroupActive(item.key) && "font-medium",
                          )}
                          isActive={item.key === activeSection}
                          tooltip={item.label}
                          render={<NavLink to={item.to} />}
                        >
                          <Icon aria-hidden="true" />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={onToggleTheme}
              tooltip={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
            >
              {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
              <span>{theme === "dark" ? "浅色主题" : "深色主题"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

