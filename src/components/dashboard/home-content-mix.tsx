import { HomeMeterRow } from "@/components/dashboard/home-meter-row";
import { PanelHead, PanelBody, PanelNote } from "@/components/dashboard/panel";
import { classifyTitles } from "@/lib/classify";
import { formatInteger, formatPercent } from "@/lib/format";
import type { StreamSummary } from "@/types/dataset";

interface HomeContentMixProps {
  rows: StreamSummary[];
}

export function HomeContentMix({ rows }: HomeContentMixProps) {
  const { types, unclassified } = classifyTitles(rows.map(row => row.title));
  const total = rows.length;

  return (
    <section className="flex min-w-0 flex-col">
      <PanelHead meta={`${formatInteger(total)} 场按标题归类`} title="内容构成" />
      <PanelBody className="flex-1 pb-3">
        <ul className="flex flex-col gap-2.5">
          {types.map(type => (
            <HomeMeterRow
              count={formatInteger(type.count)}
              key={type.key}
              label={type.label}
              max={total}
              note={formatPercent(type.share * 100, 1)}
              value={type.count}
            />
          ))}
        </ul>
      </PanelBody>
      <PanelNote className="mt-auto">
        自动分类，仅供参考 · {formatInteger(unclassified)} 场未匹配关键词，已计入杂谈
      </PanelNote>
    </section>
  );
}
