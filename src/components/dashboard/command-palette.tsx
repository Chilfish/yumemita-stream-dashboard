import { CornerDownLeft, Search } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { CommandDialog, CommandDialogPopup } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDate, formatDuration } from "@/lib/format";
import { homePath, streamPath } from "@/lib/routes";
import type { DatasetIndexEntry, StreamSummary } from "@/types/dataset";
import { cn } from "@/lib/utils";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasetId: string;
  datasets: DatasetIndexEntry[];
  rows: StreamSummary[];
}

interface CommandEntry {
  id: string;
  group: "成员" | "场次";
  label: string;
  meta: string;
  run: () => void;
}

const RESULT_LIMIT = 8;

export function CommandPalette({
  open,
  onOpenChange,
  datasetId,
  datasets,
  rows,
}: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const entries = useMemo<CommandEntry[]>(() => {
    const needle = query.trim().toLowerCase();

    const members = datasets
      .filter(member => !needle || member.label.toLowerCase().includes(needle))
      .map(member => ({
        id: `member:${member.id}`,
        group: "成员" as const,
        label: member.label,
        meta: `${member.count} 场 · ${member.channelId ?? "未记录频道"}`,
        run: () => navigate(homePath(member.id)),
      }));

    const streams = rows
      .filter(row => {
        if (!needle) return true;
        return `${row.title} ${row.videoId} ${row.date}`.toLowerCase().includes(needle);
      })
      .slice(0, needle ? RESULT_LIMIT : 6)
      .map(row => ({
        id: `stream:${row.videoId}`,
        group: "场次" as const,
        label: row.title,
        meta: `${formatDate(row.startedAt)} · ${formatDuration(row.durationSec)} · ${row.videoId}`,
        run: () => navigate(streamPath(datasetId, row.videoId)),
      }));

    return [...members, ...streams];
  }, [datasetId, datasets, navigate, query, rows]);

  useEffect(() => {
    if (!open) return;
    const active = document.getElementById(`command-option-${activeIndex}`);
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function changeOpen(next: boolean): void {
    if (!next) {
      setQuery("");
      setActiveIndex(0);
    }
    onOpenChange(next);
  }

  function changeQuery(next: string): void {
    setQuery(next);
    setActiveIndex(0);
  }

  function select(entry: CommandEntry): void {
    changeOpen(false);
    entry.run();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(index => Math.min(entries.length - 1, index + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(index => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter") {
      const entry = entries[activeIndex];
      if (!entry) return;
      event.preventDefault();
      select(entry);
    }
  }

  return (
    <CommandDialog onOpenChange={changeOpen} open={open}>
      <CommandDialogPopup>
        <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
          <Search aria-hidden="true" className="size-4 shrink-0 text-ink-3" />
          <Input
            aria-activedescendant={
              entries.length > 0 ? `command-option-${activeIndex}` : undefined
            }
            aria-controls="command-results"
            aria-expanded
            autoFocus
            className="[&>[data-slot=input]]:h-8 [&>[data-slot=input]]:leading-8"
            onChange={event => changeQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索场次或成员…"
            role="combobox"
            value={query}
          />
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <ul aria-label="搜索结果" id="command-results" role="listbox" className="p-2">
            {entries.map((entry, index) => {
              const showGroup = index === 0 || entries[index - 1]?.group !== entry.group;

              return (
                <Fragment key={entry.id}>
                  {showGroup ? (
                    <li
                      className="px-2 pt-2 pb-1 text-caption text-muted-foreground"
                      role="presentation"
                    >
                      {entry.group}
                    </li>
                  ) : null}
                  <li role="presentation">
                    <button
                      aria-selected={index === activeIndex}
                      className={cn(
                        "flex min-h-10 w-full items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors duration-120 ease-out",
                        index === activeIndex
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground hover:bg-accent/60",
                      )}
                      id={`command-option-${index}`}
                      onClick={() => select(entry)}
                      onMouseEnter={() => setActiveIndex(index)}
                      role="option"
                      type="button"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-footnote">{entry.label}</span>
                        <span className="block truncate text-caption text-ink-3">
                          {entry.meta}
                        </span>
                      </span>
                      {index === activeIndex ? (
                        <CornerDownLeft aria-hidden="true" className="size-3.5 shrink-0" />
                      ) : null}
                    </button>
                  </li>
                </Fragment>
              );
            })}
            {entries.length === 0 ? (
              <li className="px-2 py-8 text-center text-footnote text-muted-foreground">
                没有匹配的场次或成员
              </li>
            ) : null}
          </ul>
        </ScrollArea>

        <div className="flex items-center gap-3 border-t border-hairline px-3 py-2 text-caption text-ink-3">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            选择
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Enter</Kbd>
            打开
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Esc</Kbd>
            关闭
          </span>
        </div>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
