import { Guitar, Info, LayoutDashboard, Mic2, GitCompare, Moon, Sun, Table2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type { Theme } from "@/hooks/use-theme";
import { formatInteger } from "@/lib/format";
import { sectionFromPathname, viewPath, type ViewKey } from "@/lib/routes";
import type { DatasetIndexEntry } from "@/types/dataset";

interface NavItem {
  key: ViewKey;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { key: "overview", label: "总览", icon: LayoutDashboard },
  { key: "stream", label: "单场", icon: Mic2 },
  { key: "compare", label: "对比", icon: GitCompare },
  { key: "table", label: "数据表", icon: Table2 },
  { key: "about", label: "说明", icon: Info },
];

interface AppSidebarProps {
  dataset: DatasetIndexEntry;
  datasets: DatasetIndexEntry[];
  streamCount: number;
  chatTotal: number;
  theme: Theme;
  onToggleTheme: () => void;
}

export function AppSidebar({
  dataset,
  datasets,
  streamCount,
  chatTotal,
  theme,
  onToggleTheme,
}: AppSidebarProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const selectItems = datasets.map(item => ({ value: item.id, label: item.label }));
  const selected = selectItems.find(item => item.value === dataset.id) ?? null;

  function isActive(key: ViewKey): boolean {
    const target = viewPath(dataset.id, key);
    return pathname === target || pathname.startsWith(`${target}/`);
  }

  function handleDatasetChange(nextId: string | undefined): void {
    if (!nextId || nextId === dataset.id) return;
    navigate(viewPath(nextId, sectionFromPathname(pathname)));
  }

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="ゆめみた 配信数据台"
              render={<Link to={viewPath(dataset.id, "overview")} />}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted text-foreground">
                <Guitar aria-hidden="true" className="size-4" />
              </span>
              <span className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-heading font-semibold text-sm">
                  ゆめみた 配信数据台
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {dataset.label} · {dataset.count} 场
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {datasets.length > 1 ? (
          <div className="group-data-[collapsible=icon]:hidden">
            <Select
              items={selectItems}
              onValueChange={item => handleDatasetChange(item?.value)}
              value={selected}
            >
              <SelectTrigger aria-label="选择数据集" className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {selectItems.map(item => (
                  <SelectItem key={item.value} value={item}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        ) : null}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>浏览</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map(item => {
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      isActive={isActive(item.key)}
                      tooltip={item.label}
                      render={<NavLink to={viewPath(dataset.id, item.key)} />}
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
        <p className="px-2 text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
          {formatInteger(streamCount)} 场 · {formatInteger(chatTotal)} 条弹幕
        </p>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
