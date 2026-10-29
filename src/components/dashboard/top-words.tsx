import { MeterRow } from "@/components/dashboard/meter-row";
import { PanelHead, PanelBody } from "@/components/dashboard/panel";
import type { AggregatedWord } from "@/lib/aggregate";
import { formatInteger } from "@/lib/format";

const TOP_WORDS = 8;

interface TopWordsProps {
  words: AggregatedWord[];
}

export function TopWords({ words }: TopWordsProps) {
  const visible = words.slice(0, TOP_WORDS);
  const max = visible[0]?.count ?? 1;

  return (
    <section className="flex min-w-0 flex-col">
      <PanelHead meta={`Top ${visible.length}`} title="全期高频词" />
      <PanelBody className="flex-1 pb-3">
        <ul className="flex flex-col gap-2.5">
          {visible.map(word => (
            <MeterRow
              count={formatInteger(word.count)}
              key={word.word}
              label={word.word}
              max={max}
              note={`${formatInteger(word.streams)} 场`}
              value={word.count}
            />
          ))}
        </ul>
      </PanelBody>
    </section>
  );
}
