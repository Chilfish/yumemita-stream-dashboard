import { ChevronDown, TriangleAlert } from "lucide-react";
import { Fragment, useDeferredValue, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { TranscriptsToolbar } from "@/components/dashboard/transcripts-toolbar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Link } from "@/lib/router-compat";
import { formatDate, formatFullDate, formatInteger } from "@/lib/format";
import { streamPath } from "@/lib/routes";
import {
  DEFAULT_TRANSCRIPT_PARAMS,
  hasTranscriptFilters,
  type TranscriptParams,
} from "@/lib/transcript-params";
import {
  collectTranscriptTags,
  filterTranscripts,
  groupTranscriptsByMonth,
  sortTranscriptEntries,
  splitTranscriptHighlight,
  stripInlineMarkdown,
  transcriptExcerpt,
  type TranscriptIndexEntry,
} from "@/lib/transcripts";
import { cn } from "@/lib/utils";

const MONTH_SECTION_PREFIX = "transcript-month";

function monthSectionId(key: string): string {
  return `${MONTH_SECTION_PREFIX}-${key || "undated"}`;
}

function monthPanelId(key: string): string {
  return `${monthSectionId(key)}-entries`;
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const parts = splitTranscriptHighlight(text, query);

  return (
    <>
      {parts.map((part, index) =>
        part.match ? (
          <mark
            className="rounded-[2px] bg-member-ink/16 px-0.5 text-foreground"
            key={index}
          >
            {part.text}
          </mark>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

interface EntryRowProps {
  datasetId: string;
  entry: TranscriptIndexEntry;
  query: string;
  dense: boolean;
  fullDate: boolean;
}

function EntryRow({ datasetId, entry, query, dense, fullDate }: EntryRowProps) {
  const title = stripInlineMarkdown(entry.title) || entry.videoId;
  const summary = dense ? "" : transcriptExcerpt(entry.summary, query, 120);
  const date = entry.date
    ? (fullDate ? formatFullDate(entry.date) : formatDate(entry.date))
    : "—";

  return (
    <li className="border-t border-hairline first:border-t-0 [contain-intrinsic-size:auto_4.5rem] [content-visibility:auto]">
      <div
        className={cn(
          "grid gap-x-3",
          fullDate
            ? "grid-cols-[4.75rem_minmax(0,1fr)] md:grid-cols-[5.75rem_minmax(0,1fr)]"
            : "grid-cols-[3.25rem_minmax(0,1fr)] md:grid-cols-[5.5rem_minmax(0,1fr)]",
          dense ? "py-2" : "py-3",
        )}
      >
        <span className="text-caption text-ink-3 tabular-nums md:pt-0.5">{date}</span>

        <Link
          className="group flex min-w-0 flex-col gap-1 rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink"
          to={streamPath(datasetId, entry.videoId, "transcript")}
        >
          <span className="text-body font-medium text-foreground transition-colors group-hover:text-member-ink">
            <HighlightText query={query} text={title} />
          </span>
          {summary ? (
            <span className="line-clamp-2 max-w-[70ch] text-footnote text-muted-foreground">
              <HighlightText query={query} text={summary} />
            </span>
          ) : null}
          {entry.tags.length > 0 ? (
            <span className="text-caption text-ink-3">{entry.tags.join(" · ")}</span>
          ) : null}
        </Link>
      </div>
    </li>
  );
}

function TranscriptsEmpty() {
  return (
    <div className="flex flex-col items-start gap-2 rounded-panel bg-card px-4 py-8 shadow-surface">
      <p className="text-body font-medium text-foreground">还没有逐字稿</p>
      <p className="text-footnote text-muted-foreground">
        新稿发布后会自动出现在这里，按开播月份归档。
      </p>
    </div>
  );
}

function FilteredEmpty({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-panel bg-card px-4 py-8 shadow-surface">
      <div>
        <p className="text-body font-medium text-foreground">没有匹配的逐字稿</p>
        <p className="text-footnote text-muted-foreground">
          换个关键词，或者清除标签筛选。
        </p>
      </div>
      <Button onClick={onReset} size="sm" type="button" variant="outline">
        清除筛选
      </Button>
    </div>
  );
}

export interface TranscriptsViewProps {
  datasetId: string;
  datasetLabel?: string;
  entries: TranscriptIndexEntry[];
  error?: string | null;
  params: TranscriptParams;
  onParamsChange: (next: TranscriptParams) => void;
}

export function TranscriptsView({
  datasetId,
  datasetLabel,
  entries,
  error,
  params,
  onParamsChange,
}: TranscriptsViewProps) {
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const deferredQuery = useDeferredValue(params.q);
  const tagKey = params.tags.join("\u0000");
  const selectedTags = useMemo(
    () => (tagKey ? tagKey.split("\u0000") : []),
    [tagKey],
  );

  const tags = useMemo(() => collectTranscriptTags(entries), [entries]);
  const sorted = useMemo(
    () => sortTranscriptEntries(entries, params.sort),
    [entries, params.sort],
  );
  const filtered = useMemo(
    () => filterTranscripts(sorted, { query: deferredQuery, tags: selectedTags }),
    [deferredQuery, selectedTags, sorted],
  );
  const groups = useMemo(() => groupTranscriptsByMonth(filtered), [filtered]);

  const filtering = hasTranscriptFilters({ ...params, q: deferredQuery });
  const flat = filtering || params.sort === "title";
  const monthKeys = useMemo(() => groups.map(group => group.key), [groups]);
  // 默认全展开：先看到内容，分组标题只负责定位；收起由用户主动触发。
  const defaultExpanded = useMemo(() => new Set(monthKeys), [monthKeys]);
  const effectiveExpanded = expanded ?? defaultExpanded;

  function resetFilters(): void {
    onParamsChange(DEFAULT_TRANSCRIPT_PARAMS);
  }

  function toggleMonth(key: string): void {
    const next = new Set(effectiveExpanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpanded(next);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="逐字稿"
        facts={[
          {
            label: filtering ? "篇匹配" : "篇",
            value: formatInteger(filtered.length),
          },
          { label: "个月", value: formatInteger(groups.length) },
        ]}
        title={datasetLabel ?? "逐字稿索引"}
      />

      {error ? (
        <Alert variant="error">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>逐字稿索引加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {entries.length === 0 && !error ? <TranscriptsEmpty /> : null}

      {entries.length > 0 ? (
        <div className="flex flex-col gap-4">
          <div className="sticky top-12 z-20 -mx-4 border-b border-hairline bg-background/92 px-4 py-2 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
            <TranscriptsToolbar
              onChange={onParamsChange}
              params={params}
              tags={tags}
            />
          </div>

          {filtered.length === 0 ? (
            <FilteredEmpty onReset={resetFilters} />
          ) : flat ? (
            <ul className="flex flex-col">
              {filtered.map(entry => (
                <EntryRow
                  datasetId={datasetId}
                  dense={params.dense}
                  entry={entry}
                  fullDate
                  key={entry.videoId}
                  query={deferredQuery}
                />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map(group => {
                const open = effectiveExpanded.has(group.key);
                const headingId = `${monthSectionId(group.key)}-heading`;

                return (
                  <section
                    aria-labelledby={headingId}
                    className="scroll-mt-32 md:scroll-mt-16"
                    id={monthSectionId(group.key)}
                    key={group.key || "undated"}
                  >
                    <div className="md:sticky md:top-12 md:z-10 md:border-b md:border-hairline md:bg-background/92 md:backdrop-blur">
                      <h2 className="text-headline text-foreground">
                        <button
                          aria-controls={monthPanelId(group.key)}
                          aria-expanded={open}
                          className="flex w-full items-baseline gap-2 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink"
                          id={headingId}
                          onClick={() => toggleMonth(group.key)}
                          type="button"
                        >
                          <ChevronDown
                            aria-hidden="true"
                            className={cn(
                              "size-4 shrink-0 self-center text-ink-3 transition-transform duration-200",
                              !open && "-rotate-90",
                            )}
                          />
                          <span>{group.label}</span>
                          <span className="text-caption font-normal text-ink-3 tabular-nums">
                            {formatInteger(group.entries.length)} 篇
                          </span>
                        </button>
                      </h2>
                    </div>

                    {open ? (
                      <ul
                        className="[contain-intrinsic-size:auto_24rem] [content-visibility:auto]"
                        id={monthPanelId(group.key)}
                      >
                        {group.entries.map(entry => (
                          <EntryRow
                            datasetId={datasetId}
                            dense={params.dense}
                            entry={entry}
                            fullDate={false}
                            key={entry.videoId}
                            query={deferredQuery}
                          />
                        ))}
                      </ul>
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
