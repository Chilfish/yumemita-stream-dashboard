import type { ReactNode } from "react";
import { ChartFrame } from "@/components/charts/chart-frame";
import { TopBars } from "@/components/charts/top-bars";
import type { StreamRow } from "@/lib/aggregate";
import { formatInteger } from "@/lib/format";

interface StreamWordsPanelProps {
  row: StreamRow;
}

interface KeyValueRow {
  label: string;
  value: ReactNode;
  full?: string;
}

function sortCounts(counts: Record<string, number>): [string, number][] {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

export function StreamWordsPanel({ row }: StreamWordsPanelProps) {
  const { pack } = row;
  const chat = pack.chat;

  const words = chat.topWords.slice(0, 16).map(word => ({
    label: word.word,
    value: word.count,
    hint: `${formatInteger(word.count)} 次`,
  }));

  const authors = chat.topAuthors.slice(0, 12).map(author => ({
    label: author.author,
    value: author.messages,
    hint: `${formatInteger(author.messages)} 条 · SC ${author.superchats} 笔`,
  }));

  const kindRows: KeyValueRow[] = [
    { label: "文字", value: formatInteger(chat.byKind.text) },
    { label: "Super Chat", value: formatInteger(chat.byKind.superchat) },
    { label: "贴纸", value: formatInteger(chat.byKind.sticker) },
    { label: "会员", value: formatInteger(chat.byKind.membership) },
    { label: "纯表情条目", value: formatInteger(chat.pureEmojiOnly) },
    { label: "主播本人发言", value: formatInteger(chat.ownerMessages) },
  ];

  const badgeRows: KeyValueRow[] = sortCounts(chat.badges).map(([name, count]) => ({
    full: name,
    label: name,
    value: formatInteger(count),
  }));

  const emojiRows: KeyValueRow[] = [
    { label: "表情种类", value: formatInteger(chat.emojiKinds.distinct) },
    ...chat.emojiKinds.top.slice(0, 6).map(emoji => ({
      full: emoji.id,
      label: emoji.id,
      value: formatInteger(emoji.count),
    })),
  ];

  const hashtagRows: KeyValueRow[] = sortCounts(chat.hashtags).map(([tag, count]) => ({
    full: tag,
    label: tag,
    value: formatInteger(count),
  }));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartFrame
          meta="本场 Top 40 词表截断到 16；日语分词，不合并表记揺れ。"
          title="高频词"
        >
          <TopBars emptyMessage="本场没有抓取到高频词" items={words} />
        </ChartFrame>

        <ChartFrame
          meta={`本场 Top 20 发言者截断到 12；共 ${formatInteger(chat.uniqueAuthors)} 人发言。`}
          title="发言者"
        >
          <TopBars emptyMessage="本场没有发言者排行" items={authors} labelWidth={128} />
        </ChartFrame>
      </div>

      <div className="grid grid-cols-1 gap-5 border-t border-hairline pt-5 sm:grid-cols-2 lg:grid-cols-4">
        <KeyValueGroup emptyText="本场没有弹幕" rows={kindRows} title="弹幕构成" />
        <KeyValueGroup emptyText="本场弹幕没有携带徽章" rows={badgeRows} title="徽章" />
        <KeyValueGroup emptyText="本场没有表情" rows={emojiRows} title="表情" />
        {hashtagRows.length > 0 ? (
          <KeyValueGroup emptyText="本场没有 Hashtag" rows={hashtagRows} title="Hashtag" />
        ) : null}
      </div>
    </div>
  );
}

interface KeyValueGroupProps {
  title: string;
  rows: KeyValueRow[];
  emptyText: string;
}

function KeyValueGroup({ title, rows, emptyText }: KeyValueGroupProps) {
  return (
    <section className="min-w-0">
      <h3 className="text-caption text-muted-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-footnote text-ink-3">{emptyText}</p>
      ) : (
        <dl className="mt-1 divide-y divide-hairline">
          {rows.map((row, index) => (
            <div
              className="flex items-baseline justify-between gap-2 py-1"
              key={`${row.full ?? row.label}-${index}`}
            >
              <dt className="min-w-0 truncate text-footnote text-muted-foreground" title={row.full ?? row.label}>
                {row.label}
              </dt>
              <dd className="shrink-0 text-footnote font-semibold tabular-nums text-foreground">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
