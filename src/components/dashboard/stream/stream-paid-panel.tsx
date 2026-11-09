import { ChartFrame } from "@/components/charts/chart-frame";
import { EmojiImage } from "@/components/dashboard/primitives/emoji-image";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipCreateHandle,
  TooltipPopup,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEmojiIndex } from "@/hooks/use-emoji-index";
import type { StreamRow } from "@/lib/aggregate";
import {
  currencyLabel,
  formatCurrency,
  formatDateTimeSeconds,
  formatDuration,
  formatInteger,
  formatPercent,
  formatTime,
  streamOffsetSeconds,
} from "@/lib/format";
import { isCustomEmojiId } from "@/lib/emoji";
import { youtubeTimeUrl } from "@/lib/transcripts";
import { cn } from "@/lib/utils";
import type {
  CurrencyTotals,
  EmojiAsset,
  GiftMembership,
  Membership,
  Sticker,
  Superchat,
} from "@/types/datapack";

/** 所有 SC 的时间戳共用一个 tooltip：几百行明细也只挂一个 Portal，相邻条目间没有打开延迟。 */
const superchatTimeTooltip = TooltipCreateHandle<{ at: string }>();

interface StreamPaidPanelProps {
  datasetId: string;
  row: StreamRow;
}

function currencyEntries(totals: CurrencyTotals): [string, CurrencyTotals[string]][] {
  return Object.entries(totals).sort((a, b) => b[1].amount - a[1].amount);
}

export function StreamPaidPanel({ datasetId, row }: StreamPaidPanelProps) {
  const { pack } = row;
  const emojiIndex = useEmojiIndex(datasetId);
  const emojiAssets = new Map((pack.chat.emojis ?? []).map(asset => [asset.id, asset] as const));
  for (const [id, name] of emojiIndex) {
    if (!emojiAssets.has(id))
      emojiAssets.set(id, { id, name, url: "" });
  }
  const paid = pack.chat.paid;
  const superchats = [...paid.superchats].sort((a, b) => a.at.localeCompare(b.at));
  const startedAt = pack.video.startedAt ?? row.summary.startedAt;
  const videoId = pack.video.id;
  const scTotals = currencyEntries(paid.scTotalsByCurrency);
  const stickerTotals = currencyEntries(paid.stickerTotalsByCurrency);
  const gifts = paid.gifts ?? [];
  const giftTotal = gifts.reduce((sum, gift) => sum + gift.count, 0);
  const hasSc = superchats.length > 0;
  const hasOtherPaid =
    paid.stickers.length > 0 || paid.memberships.length > 0 || gifts.length > 0;

  return (
    <div className="flex flex-col gap-5">
      {hasSc ? (
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-headline text-foreground">SC 合计</h2>
            <p className="text-caption text-ink-3">
              共 {formatInteger(superchats.length)} 笔 ·{" "}
              {pack.derived.scPerHour?.toFixed(2) ?? "—"} 笔/小时 · 付费弹幕占{" "}
              {formatPercent(paid.paidSharePct)}
            </p>
          </div>

          <dl className="mt-2 grid grid-cols-1 divide-y divide-hairline sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {scTotals.map(([currency, total], index) => (
              <div className={index === 0 ? "py-2 sm:pe-4" : "py-2 sm:px-4"} key={currency}>
                <dt className="text-caption text-muted-foreground">
                  {currencyLabel(currency)}{" "}
                  <span className="tabular-nums">· {formatInteger(total.count)} 笔</span>
                </dt>
                <dd className="font-semibold text-paid text-stat-sm tabular-nums">
                  {formatCurrency(currency, total.amount)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : (
        <section className="flex flex-col items-center gap-1 py-8 text-center">
          <h2 className="text-headline text-foreground">本场没有 SC</h2>
        </section>
      )}

      {hasSc ? (
        <section className="border-t border-hairline pt-5">
          <ChartFrame
            meta={`共 ${formatInteger(superchats.length)} 笔`}
            title="SC 明细"
          >
            <ScrollArea className="h-[min(62dvh,32.5rem)]" overscrollContain>
              <Tooltip handle={superchatTimeTooltip}>
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

              <div className="hidden md:block">
                <Table aria-label="SC 明细">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">时间</TableHead>
                      <TableHead className="w-40">作者</TableHead>
                      <TableHead className="w-24 text-right">金额</TableHead>
                      <TableHead>留言</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-hairline">
                    {superchats.map((superchat, index) => (
                      <TableRow
                        className="border-b-0"
                        key={`${superchat.at}-${superchat.author}-${index}`}
                      >
                        <TableCell className="text-footnote tabular-nums text-muted-foreground">
                          <SuperchatTime
                            startedAt={startedAt}
                            superchat={superchat}
                            videoId={videoId}
                          />
                        </TableCell>
                        <TableCell className="max-w-40 truncate text-footnote">
                          {superchat.author}
                        </TableCell>
                        <TableCell className="text-right text-footnote font-semibold text-paid tabular-nums">
                          {superchat.amountText}
                        </TableCell>
                        <TableCell className="max-w-[32.5rem] whitespace-normal text-footnote leading-relaxed">
                          <SuperchatMessage
                            datasetId={datasetId}
                            emojiAssets={emojiAssets}
                            superchat={superchat}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <ul aria-label="SC 明细" className="divide-y divide-hairline md:hidden">
                {superchats.map((superchat, index) => (
                  <li
                    className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"
                    key={`${superchat.at}-${superchat.author}-${index}`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <SuperchatTime
                        className="text-footnote tabular-nums text-muted-foreground"
                        startedAt={startedAt}
                        superchat={superchat}
                        videoId={videoId}
                      />
                      <span className="shrink-0 text-footnote font-semibold text-paid tabular-nums">
                        {superchat.amountText}
                      </span>
                    </div>
                    <p className="text-footnote font-medium text-foreground">{superchat.author}</p>
                    <p className="break-words text-footnote leading-relaxed text-foreground">
                      <SuperchatMessage
                        datasetId={datasetId}
                        emojiAssets={emojiAssets}
                        superchat={superchat}
                      />
                    </p>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </ChartFrame>
        </section>
      ) : null}

      {hasOtherPaid ? (
        <section className="grid grid-cols-1 gap-5 border-t border-hairline pt-5 sm:grid-cols-2">
          {gifts.length > 0 ? (
            <div>
              <h3 className="text-caption text-muted-foreground">
                赠送会员 · {formatInteger(gifts.length)} 次 · 共 {formatInteger(giftTotal)} 个
              </h3>
              <GiftList gifts={gifts} />
            </div>
          ) : null}

          {paid.stickers.length > 0 ? (
            <div>
              <h3 className="text-caption text-muted-foreground">
                贴纸 · {formatInteger(paid.stickers.length)} 条
              </h3>
              <dl className="mt-1 divide-y divide-hairline">
                {stickerTotals.map(([currency, total]) => (
                  <div className="flex items-baseline justify-between gap-2 py-1" key={currency}>
                    <dt className="text-footnote text-muted-foreground">
                      {currencyLabel(currency)} · {formatInteger(total.count)} 条
                    </dt>
                    <dd className="text-footnote font-semibold tabular-nums">
                      {formatCurrency(currency, total.amount)}
                    </dd>
                  </div>
                ))}
              </dl>
              <StickerList stickers={paid.stickers} />
            </div>
          ) : null}

          {paid.memberships.length > 0 ? (
            <div>
              <h3 className="text-caption text-muted-foreground">
                会员 · {formatInteger(paid.memberships.length)} 条
              </h3>
              <MembershipList memberships={paid.memberships} />
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

interface SuperchatTimeProps {
  className?: string;
  startedAt: string | null;
  superchat: Superchat;
  videoId: string;
}

function SuperchatTime({ className, startedAt, superchat, videoId }: SuperchatTimeProps) {
  const offset = streamOffsetSeconds(superchat.at, startedAt);
  if (offset == null) {
    return <span className={className}>{formatTime(superchat.at)}</span>;
  }
  return (
    <TooltipTrigger
      handle={superchatTimeTooltip}
      payload={{ at: superchat.at }}
      render={props => (
        <a
          {...props}
          aria-label={`在 YouTube 打开（开播后 ${formatDuration(offset)}）`}
          className={cn("underline-offset-2 hover:text-foreground hover:underline", className)}
          href={youtubeTimeUrl(videoId, offset)}
          rel="noreferrer"
          target="_blank"
        >
          {formatDuration(offset)}
        </a>
      )}
    />
  );
}

interface SuperchatMessageProps {
  datasetId: string;
  emojiAssets: Map<string, EmojiAsset>;
  superchat: Superchat;
}

function SuperchatMessage({ datasetId, emojiAssets, superchat }: SuperchatMessageProps) {
  return (
    <>
      {superchat.message}
      {superchat.emojis?.map((emojiId, index) => (
        <EmojiImage
          key={`${emojiId}-${index}`}
          className="mx-0.5 inline-block size-[1.2em] align-[-0.2em]"
          datasetId={datasetId}
          emojiId={emojiId}
          fallback={isCustomEmojiId(emojiId) ? "[表情]" : emojiId}
          name={emojiAssets.get(emojiId)?.name}
        />
      ))}
      {superchat.message || superchat.emojis?.length ? null : (
        <span className="text-ink-3">（无留言）</span>
      )}
    </>
  );
}

function StickerList({ stickers }: { stickers: Sticker[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-0.5">
      {stickers.slice(0, 6).map((sticker, index) => (
        <li
          className="flex items-baseline justify-between gap-2 text-footnote"
          key={`${sticker.at}-${sticker.author}-${index}`}
        >
          <span className="min-w-0 truncate text-muted-foreground">
            <span className="tabular-nums text-ink-3">{formatTime(sticker.at)}</span> ·{" "}
            {sticker.author}
          </span>
          <span className="shrink-0 tabular-nums text-foreground">{sticker.amountText}</span>
        </li>
      ))}
      {stickers.length > 6 ? (
        <li className="text-caption text-ink-3">另有 {stickers.length - 6} 条未展开</li>
      ) : null}
    </ul>
  );
}

function GiftList({ gifts }: { gifts: GiftMembership[] }) {
  return (
    <ul className="mt-1 flex flex-col gap-0.5 divide-y divide-hairline">
      {gifts.slice(0, 8).map((gift, index) => (
        <li
          className="flex items-baseline justify-between gap-2 py-1 text-footnote"
          key={`${gift.at}-${gift.author}-${index}`}
          title={gift.text}
        >
          <span className="min-w-0 truncate text-muted-foreground">
            <span className="tabular-nums text-ink-3">{formatTime(gift.at)}</span> ·{" "}
            {gift.author}
          </span>
          <span className="shrink-0 tabular-nums text-foreground">×{formatInteger(gift.count)}</span>
        </li>
      ))}
      {gifts.length > 8 ? (
        <li className="py-1 text-caption text-ink-3">另有 {gifts.length - 8} 次未展开</li>
      ) : null}
    </ul>
  );
}

function MembershipList({ memberships }: { memberships: Membership[] }) {
  return (
    <ul className="mt-1 flex flex-col gap-0.5 divide-y divide-hairline">
      {memberships.slice(0, 8).map((membership, index) => (
        <li
          className="flex items-baseline justify-between gap-2 py-1 text-footnote"
          key={`${membership.at}-${membership.author}-${index}`}
        >
          <span className="min-w-0 truncate text-foreground">{membership.author}</span>
          <span
            className="max-w-[60%] shrink-0 truncate text-caption text-ink-3"
            title={membership.header ?? undefined}
          >
            {membership.header ?? formatTime(membership.at)}
          </span>
        </li>
      ))}
      {memberships.length > 8 ? (
        <li className="py-1 text-caption text-ink-3">另有 {memberships.length - 8} 条未展开</li>
      ) : null}
    </ul>
  );
}
