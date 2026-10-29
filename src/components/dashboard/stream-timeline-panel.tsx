import type { ReactNode } from "react";
import { ChartFrame } from "@/components/charts/chart-frame";
import { StreamTimeline } from "@/components/charts/stream-timeline";
import type { StreamRow } from "@/lib/aggregate";
import { formatCurrency, formatInteger, formatTime } from "@/lib/format";
import type { Superchat } from "@/types/datapack";

interface StreamTimelinePanelProps {
  row: StreamRow;
}

/** 距结束还有多少分钟；时间戳不可解析时返回 null。 */
function minutesBeforeEnd(at: string, endAt: string | null): number | null {
  if (!endAt) return null;
  const end = Date.parse(endAt);
  const start = Date.parse(at);
  if (Number.isNaN(end) || Number.isNaN(start)) return null;
  return (end - start) / 60_000;
}

/** 每种币种面额最大的一笔；币种之间不做换算。 */
function topPerCurrency(superchats: Superchat[]): Superchat[] {
  const best = new Map<string, Superchat>();
  for (const superchat of superchats) {
    const current = best.get(superchat.currency);
    if (!current || superchat.amount > current.amount) best.set(superchat.currency, superchat);
  }
  return [...best.values()].sort((a, b) => b.amount - a.amount);
}

export function StreamTimelinePanel({ row }: StreamTimelinePanelProps) {
  const { pack, summary } = row;
  const density = pack.chat.density;
  const superchats = pack.chat.paid.superchats;
  const endAt = summary.endedAt ?? pack.video.endedAt ?? pack.chat.timeRange.lastAt;
  const tailWindowMin = 10;
  const tailSuperchats = superchats.filter(superchat => {
    const before = minutesBeforeEnd(superchat.at, endAt);
    return before != null && before >= 0 && before <= tailWindowMin;
  });
  const biggest = topPerCurrency(superchats);

  return (
    <div className="flex flex-col gap-5">
      <section>
        <ChartFrame
          meta={`覆盖 ${pack.chat.coveragePct?.toFixed(1) ?? "—"}%；X 轴为直播第几分钟，三角为峰值分钟。`}
          note="悬停或拖动可读出任一分钟的弹幕条数与 SC 笔数；完整明细见「付费」与「弹幕与词」。"
          title="时间轴"
        >
          <StreamTimeline
            ariaLabel={`${summary.title} 的弹幕与 SC 时间轴`}
            minutes={density.perMinute}
            peak={density.peakMinute}
            superchats={density.perMinuteSc}
          />
        </ChartFrame>
      </section>

      <section className="border-t border-hairline pt-5">
        <h2 className="text-headline text-foreground">高光</h2>

        <div className="mt-2 divide-y divide-hairline">
          {density.peakMinute ? (
            <Highlight
              label="峰值"
              main={
                <>
                  第 {density.peakMinute.offsetMin} 分 · {formatInteger(density.peakMinute.count)} 条/分
                </>
              }
              sub={
                <>
                  {density.peakMinute.at ? `${formatTime(density.peakMinute.at)} 前后 · ` : ""}
                  全场均值 {density.perMinuteMean?.toFixed(1) ?? "—"} 条/分
                </>
              }
            />
          ) : (
            <Highlight label="峰值" main="没有峰值分钟数据" sub="逐分钟弹幕缺失，峰值无法定位。" />
          )}

          {superchats.length === 0 ? (
            <Highlight
              label="付费"
              main="本场没有 SC"
              sub="SC 轨为空；弹幕与评论不受影响。"
            />
          ) : (
            <>
              <Highlight
                label="收尾"
                main={
                  tailSuperchats.length > 0
                    ? `最后 ${tailWindowMin} 分钟 ${tailSuperchats.length} 笔 SC`
                    : `最后 ${tailWindowMin} 分钟没有 SC`
                }
                sub={
                  tailSuperchats.length > 0 ? (
                    <>
                      {tailSuperchats
                        .slice(0, 3)
                        .map(superchat => superchat.amountText)
                        .join(" · ")}
                      {tailSuperchats.length > 3 ? " 等" : ""} · 全场共 {superchats.length} 笔
                    </>
                  ) : (
                    <>收尾阶段没有付费；时间轴上 SC 刻度更靠前。</>
                  )
                }
              />

              <Highlight
                label="单笔最高"
                main={biggest
                  .slice(0, 3)
                  .map(
                    superchat =>
                      `${formatCurrency(superchat.currency, superchat.amount)}（${superchat.author}）`,
                  )
                  .join(" · ")}
                sub={`按币种分别取最高面额，不换算汇率；本场共 ${superchats.length} 笔 SC。`}
              />
            </>
          )}
        </div>
      </section>
    </div>
  );
}

interface HighlightProps {
  label: string;
  main: ReactNode;
  sub?: ReactNode;
}

function Highlight({ label, main, sub }: HighlightProps) {
  return (
    <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-3 py-3 first:pt-0 last:pb-0">
      <p className="pt-0.5 text-caption text-ink-3">{label}</p>
      <div className="min-w-0">
        <p className="text-body text-foreground">{main}</p>
        {sub ? <p className="mt-0.5 text-caption text-muted-foreground">{sub}</p> : null}
      </div>
    </div>
  );
}
