import { useId, useState } from "react";
import { MeterRow } from "@/components/dashboard/meter-row";
import { PanelBody, PanelHead } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import type { AggregatedAuthor } from "@/lib/aggregate";
import { formatInteger } from "@/lib/format";

const COLLAPSED = 5;
const EXPANDED = 12;

interface TopAuthorsProps {
  authors: AggregatedAuthor[];
}

export function TopAuthors({ authors }: TopAuthorsProps) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const limit = expanded ? EXPANDED : COLLAPSED;
  const visible = authors.slice(0, limit);
  const max = visible[0]?.messages ?? 1;
  const canExpand = authors.length > COLLAPSED;

  return (
    <section className="flex min-w-0 flex-col">
      <PanelHead
        actions={
          canExpand ? (
            <Button
              aria-controls={listId}
              aria-expanded={expanded}
              onClick={() => setExpanded(current => !current)}
              size="xs"
              variant="ghost"
            >
              {expanded ? "收起" : `展开 ${Math.min(EXPANDED, authors.length)} 位`}
            </Button>
          ) : null
        }
        title="全期高频发言者"
      />
      <PanelBody className="pb-4">
        <ul className="grid gap-x-6 gap-y-2.5" id={listId}>
          {visible.map(author => (
            <MeterRow
              count={formatInteger(author.messages)}
              key={author.author}
              label={author.author}
              max={max}
              note={`${formatInteger(author.streams)} 场`}
              value={author.messages}
            />
          ))}
        </ul>
      </PanelBody>
    </section>
  );
}
