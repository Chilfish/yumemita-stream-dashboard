import type { ReactNode } from "react";
import { ChartFrame } from "@/components/charts/chart-frame";
import { TopBars } from "@/components/charts/top-bars";
import { EmojiImage } from "@/components/dashboard/emoji-image";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipCreateHandle,
  TooltipPopup,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { StreamRow } from "@/lib/aggregate";
import { streamTopWords } from "@/lib/aggregate";
import { useEmojiIndex } from "@/hooks/use-emoji-index";
import { isCustomEmojiId } from "@/lib/emoji";
import {
  formatDateTimeSeconds,
  formatDuration,
  formatInteger,
  formatTime,
  streamOffsetSeconds,
} from "@/lib/format";
import { youtubeTimeUrl } from "@/lib/transcripts";
import type { EmojiAsset, OwnerChat } from "@/types/datapack";

/** 所有主播发言的时间戳共用一个 tooltip：长列表只挂一个 Portal，相邻条目间也没有打开延迟。 */
const ownerTimeTooltip = TooltipCreateHandle<{ at: string }>();

interface StreamWordsPanelProps {
  datasetId: string;
  row: StreamRow;
}

interface KeyValueRow {
  label: string;
  value: ReactNode;
  full?: string;
  visual?: ReactNode;
}

function sortCounts(counts: Record<string, number>): [string, number][] {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

export function StreamWordsPanel({ datasetId, row }: StreamWordsPanelProps) {
  const { pack } = row;
  const chat = pack.chat;

  const words = streamTopWords(chat).slice(0, 16).map(word => ({
    label: word.word,
    value: word.count,
    hint: `${formatInteger(word.count)} 次`,
  }));

  const authors = chat.topAuthors.slice(0, 12).map(author => ({
    label: author.author,
    value: author.messages,
    hint: `${formatInteger(author.messages)} 条 · SC ${author.superchats} 笔`,
  }));

  const giftCount = chat.byKind.gift ?? 0;
  const kindRows: KeyValueRow[] = [
    { label: "文字", value: formatInteger(chat.byKind.text) },
    { label: "Super Chat", value: formatInteger(chat.byKind.superchat) },
    { label: "贴纸", value: formatInteger(chat.byKind.sticker) },
    { label: "会员", value: formatInteger(chat.byKind.membership) },
    ...(giftCount > 0 ? [{ label: "赠送会员", value: formatInteger(giftCount) }] : []),
    { label: "纯表情条目", value: formatInteger(chat.pureEmojiOnly) },
    { label: "主播本人发言", value: formatInteger(chat.ownerMessages) },
  ];

  const badgeRows: KeyValueRow[] = sortCounts(chat.badges).map(([name, count]) => ({
    full: name,
    label: name,
    value: formatInteger(count),
  }));

  // 旧 pack 没有 chat.emojis：用 dataset 级表情字典补名称（手动跑过 fetch:emoji 才有）。
  const emojiIndex = useEmojiIndex(datasetId);
  const emojiAssets = new Map((chat.emojis ?? []).map(asset => [asset.id, asset] as const));
  for (const [id, name] of emojiIndex) {
    if (!emojiAssets.has(id))
      emojiAssets.set(id, { id, name, url: "" });
  }
  const ownerChats = chat.ownerChats ?? [];
  const ownerStartedAt = pack.video.startedAt ?? row.summary.startedAt;
  const emojiRows: KeyValueRow[] = [
    { label: "表情种类", value: formatInteger(chat.emojiKinds.distinct) },
    ...chat.emojiKinds.top.slice(0, 100).map((emoji) => {
      const asset = emojiAssets.get(emoji.id);
      const custom = isCustomEmojiId(emoji.id);
      return {
        full: emoji.id,
        label: custom ? (asset?.name ?? "") : emoji.id,
        value: formatInteger(emoji.count),
        ...(custom
          ? {
              visual: (
                <EmojiImage
                  className="size-5 shrink-0"
                  datasetId={datasetId}
                  emojiId={emoji.id}
                  fallback="[表情]"
                  name={asset?.name}
                />
              ),
            }
          : {}),
      };
    }),
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
          meta={`${formatInteger(words.length)} 个词`}
          title="高频词"
        >
          <TopBars emptyMessage="本场没有抓取到高频词" items={words} />
        </ChartFrame>

        <ChartFrame
          meta={`共 ${formatInteger(chat.uniqueAuthors)} 人发言`}
          title="发言者"
        >
          <TopBars emptyMessage="本场没有发言者排行" items={authors} labelWidth={128} />
        </ChartFrame>
      </div>

      {ownerChats.length > 0 ? (
        <section className="border-t border-hairline pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-headline text-foreground">主播本人发言</h2>
            <p className="text-caption text-ink-3">
              共 {formatInteger(ownerChats.length)} 条
            </p>
          </div>
          {ownerChats.length > 24 ? (
            <ScrollArea className="mt-2 h-[min(50dvh,26rem)] pe-2">
              <OwnerChatList
                chats={ownerChats}
                datasetId={datasetId}
                emojiAssets={emojiAssets}
                startedAt={ownerStartedAt}
                videoId={pack.video.id}
              />
            </ScrollArea>
          ) : (
            <div className="mt-2">
              <OwnerChatList
                chats={ownerChats}
                datasetId={datasetId}
                emojiAssets={emojiAssets}
                startedAt={ownerStartedAt}
                videoId={pack.video.id}
              />
            </div>
          )}
        </section>
      ) : null}

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

interface OwnerChatListProps {
  chats: OwnerChat[];
  datasetId: string;
  emojiAssets: Map<string, EmojiAsset>;
  startedAt: string | null;
  videoId: string;
}

function OwnerChatList({
  chats,
  datasetId,
  emojiAssets,
  startedAt,
  videoId,
}: OwnerChatListProps) {
  return (
    <>
      <Tooltip handle={ownerTimeTooltip}>
        {({ payload }) => (
          <TooltipPopup align="start" className="max-w-72">
            <span className="block font-medium text-foreground">在 YouTube 打开</span>
            {payload ? (
              <span className="block text-muted-foreground">
                {formatDateTimeSeconds(payload.at)} JST
              </span>
            ) : null}
          </TooltipPopup>
        )}
      </Tooltip>
      <ol className="flex flex-col divide-y divide-hairline">
        {chats.map((message, index) => {
          const offset = streamOffsetSeconds(message.at, startedAt);
          return (
            <li
              className="flex items-start gap-3 py-2 [contain-intrinsic-size:auto_2.75rem] [content-visibility:auto]"
              key={`${message.at}-${index}`}
            >
              {offset == null ? (
                <span className="w-16 shrink-0 pt-0.5 text-footnote tabular-nums text-ink-3">
                  {formatTime(message.at)}
                </span>
              ) : (
                <TooltipTrigger
                  handle={ownerTimeTooltip}
                  payload={{ at: message.at }}
                  render={props => (
                    <a
                      {...props}
                      aria-label={`在 YouTube 打开（开播后 ${formatDuration(offset)}）`}
                      className="w-16 shrink-0 pt-0.5 text-footnote tabular-nums text-ink-3 underline-offset-2 hover:text-foreground hover:underline"
                      href={youtubeTimeUrl(videoId, offset)}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {formatDuration(offset)}
                    </a>
                  )}
                />
              )}
              <p className="min-w-0 whitespace-pre-wrap break-words text-footnote leading-relaxed text-foreground">
                {message.text}
                {message.emojis?.map((emojiId, emojiIndex) => (
                  <EmojiImage
                    key={`${emojiId}-${emojiIndex}`}
                    className="mx-0.5 inline-block size-[1.2em] align-[-0.2em]"
                    datasetId={datasetId}
                    emojiId={emojiId}
                    fallback={isCustomEmojiId(emojiId) ? "[表情]" : emojiId}
                    name={emojiAssets.get(emojiId)?.name}
                  />
                ))}
                {message.text || message.emojis?.length ? null : (
                  <span className="text-ink-3">（无内容）</span>
                )}
              </p>
            </li>
          );
        })}
      </ol>
    </>
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
              <dt className="flex min-w-0 items-center gap-1.5 text-footnote text-muted-foreground" title={row.full ?? row.label}>
                {row.visual}
                <span className="truncate">{row.label}</span>
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
