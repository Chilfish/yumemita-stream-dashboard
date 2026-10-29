import { Search } from "lucide-react";
import { Link } from "react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { formatDate, formatInteger } from "@/lib/format";
import { homePath, type ViewKey } from "@/lib/routes";
import type { DatasetIndexEntry, StreamSummary } from "@/types/dataset";

const SECTION_LABELS: Record<ViewKey, string> = {
  home: "首页",
  streams: "场次",
  stream: "单场",
  trends: "趋势",
  compare: "对比",
  gallery: "相册",
  transcripts: "逐字稿",
  about: "说明",
};

interface AppHeaderProps {
  dataset: DatasetIndexEntry;
  section: ViewKey;
  stream: StreamSummary | null;
  streamCount: number;
  chatTotal: number;
  onOpenCommand: () => void;
}

export function AppHeader({
  dataset,
  section,
  stream,
  streamCount,
  chatTotal,
  onOpenCommand,
}: AppHeaderProps) {
  return (
    <header className="scroll-edge sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-hairline bg-background/88 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/72 md:px-4">
      <SidebarTrigger className="size-7 text-muted-foreground" />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem>
            <BreadcrumbLink
              className="whitespace-nowrap text-muted-foreground"
              render={<Link to={homePath(dataset.id)} />}
            >
              {dataset.label}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem className="min-w-0">
            {stream ? (
              <BreadcrumbPage className="max-w-[42ch] truncate">
                {formatDate(stream.startedAt)} · {stream.title}
              </BreadcrumbPage>
            ) : (
              <BreadcrumbPage>{SECTION_LABELS[section]}</BreadcrumbPage>
            )}
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ms-auto flex shrink-0 items-center gap-2">
        <p className="hidden text-caption text-ink-3 tabular-nums sm:block">
          {formatInteger(streamCount)} 场 · {formatInteger(chatTotal)} 条弹幕
        </p>
        <Button
          aria-label="搜索场次与成员（⌘K）"
          className="text-muted-foreground"
          onClick={onOpenCommand}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Search aria-hidden="true" />
          <span className="hidden lg:inline">搜索</span>
          <Kbd className="hidden md:inline-flex">⌘K</Kbd>
        </Button>
      </div>
    </header>
  );
}
