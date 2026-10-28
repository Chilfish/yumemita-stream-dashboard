import { Link } from "react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { formatDate, formatInteger } from "@/lib/format";
import { viewPath, type ViewKey } from "@/lib/routes";
import type { StreamRow } from "@/lib/aggregate";
import type { DatasetIndexEntry } from "@/types/dataset";

const SECTION_LABELS: Record<ViewKey, string> = {
  overview: "总览",
  stream: "单场",
  compare: "对比",
  table: "数据表",
  about: "说明",
};

interface AppHeaderProps {
  dataset: DatasetIndexEntry;
  section: ViewKey;
  stream: StreamRow | null;
  streamCount: number;
  chatTotal: number;
}

export function AppHeader({ dataset, section, stream, streamCount, chatTotal }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/88 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/72 md:px-4">
      <SidebarTrigger />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem>
            <BreadcrumbLink
              className="whitespace-nowrap"
              render={<Link to={viewPath(dataset.id, "overview")} />}
            >
              {dataset.label}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem className="min-w-0">
            {stream ? <BreadcrumbPage className="truncate">{formatDate(stream.summary.startedAt)} 单场</BreadcrumbPage> : <BreadcrumbPage>{SECTION_LABELS[section]}</BreadcrumbPage>}
          </BreadcrumbItem>
          {stream ? (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className="truncate">{stream.summary.title}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          ) : null}
        </BreadcrumbList>
      </Breadcrumb>

      <p className="ms-auto hidden shrink-0 text-muted-foreground text-xs sm:block">
        {formatInteger(streamCount)} 场 · {formatInteger(chatTotal)} 条弹幕
      </p>
    </header>
  );
}
