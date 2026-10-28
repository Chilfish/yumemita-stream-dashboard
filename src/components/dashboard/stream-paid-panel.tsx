import { ChartFrame } from "@/components/charts/chart-frame";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { StreamRow } from "@/lib/aggregate";
import {
  currencyLabel,
  formatCurrency,
  formatInteger,
  formatPercent,
  formatTime,
} from "@/lib/format";
import type { CurrencyTotals, Membership, Sticker } from "@/types/datapack";

interface StreamPaidPanelProps {
  row: StreamRow;
}

function currencyEntries(totals: CurrencyTotals): [string, CurrencyTotals[string]][] {
  return Object.entries(totals).sort((a, b) => b[1].amount - a[1].amount);
}

export function StreamPaidPanel({ row }: StreamPaidPanelProps) {
  const { pack } = row;
  const paid = pack.chat.paid;
  const superchats = [...paid.superchats].sort((a, b) => b.at.localeCompare(a.at));
  const scTotals = currencyEntries(paid.scTotalsByCurrency);
  const stickerTotals = currencyEntries(paid.stickerTotalsByCurrency);
  const hasSc = superchats.length > 0;
  const hasOtherPaid = paid.stickers.length > 0 || paid.memberships.length > 0;

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
                <dd className="font-semibold text-[18px] text-paid tabular-nums leading-[22px]">
                  {formatCurrency(currency, total.amount)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-caption text-ink-3">金额按原文表记，不换算汇率。</p>
        </section>
      ) : (
        <section className="flex flex-col items-center gap-1 py-8 text-center">
          <h2 className="text-headline text-foreground">本场没有 SC</h2>
          <p className="max-w-md text-footnote text-muted-foreground">
            抓取到的付费事件里没有 Super Chat，因此没有明细表与币种合计；时间轴的 SC 轨为空，
            弹幕、评论与观看数据不受影响。
          </p>
        </section>
      )}

      {hasSc ? (
        <section className="border-t border-hairline pt-5">
          <ChartFrame
            meta={`共 ${formatInteger(superchats.length)} 笔；时间 / 作者 / 金额 / 留言，金额不换算汇率。`}
            title="SC 明细"
          >
            <ScrollArea className="h-[520px]">
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
                        {formatTime(superchat.at)}
                      </TableCell>
                      <TableCell className="max-w-40 truncate text-footnote">
                        {superchat.author}
                      </TableCell>
                      <TableCell className="text-right text-footnote font-semibold text-paid tabular-nums">
                        {superchat.amountText}
                      </TableCell>
                      <TableCell className="max-w-[520px] whitespace-normal text-footnote leading-relaxed">
                        {superchat.message || (
                          <span className="text-ink-3">（无留言）</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </ChartFrame>
        </section>
      ) : null}

      {hasOtherPaid ? (
        <section className="grid grid-cols-1 gap-5 border-t border-hairline pt-5 sm:grid-cols-2">
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

function MembershipList({ memberships }: { memberships: Membership[] }) {
  return (
    <ul className="mt-1 flex flex-col gap-0.5 divide-y divide-hairline">
      {memberships.slice(0, 8).map((membership, index) => (
        <li
          className="flex items-baseline justify-between gap-2 py-1 text-footnote"
          key={`${membership.at}-${membership.author}-${index}`}
        >
          <span className="min-w-0 truncate text-foreground">{membership.author}</span>
          <span className="shrink-0 text-caption text-ink-3">
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
