import { cn } from "@/lib/utils";
import { formatInteger } from "@/lib/format";
import type { GroupTotals } from "@/lib/group";

interface GroupPulseProps {
  totals: GroupTotals;
}

/**
 * 组级脉冲：三个带窗口的数字（近 7 天场次 / 近 7 天弹幕 / 本月场次），
 * 全组累计压成一行脚注。窗口固定写在标题里，避免「7 天」被读成自然周或滚动 7 天。
 * 手机上一行三格 + 一行脚注，别把 hero 推下第一屏。
 */
export function GroupPulse({ totals }: GroupPulseProps) {
  const items = [
    { label: "近 7 天场次", value: totals.weekStreams },
    { label: "近 7 天弹幕", value: totals.weekChat },
    { label: "本月场次", value: totals.monthStreams },
  ];

  return (
    <section aria-labelledby="group-pulse-heading" className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 className="text-caption text-ink-3" id="group-pulse-heading">
          最近 7 天（含今天，日本时间）
        </h2>
        <p className="text-caption text-ink-3">本月按日本时间</p>
      </div>

      <dl className="mt-1.5 grid grid-cols-3 border-y border-hairline">
        {items.map((item, index) => (
          <div
            className={cn("min-w-0 py-2.5", index === 0 ? "pe-3" : "border-s border-hairline ps-3")}
            key={item.label}
          >
            <dt className="truncate text-caption text-muted-foreground">{item.label}</dt>
            <dd className="mt-0.5 text-stat-sm tabular-nums text-foreground">
              {formatInteger(item.value)}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-1.5 text-caption text-ink-3 tabular-nums">
        全组累计 {formatInteger(totals.streamCount)} 场 · {formatInteger(totals.chatTotal)} 条弹幕
        · {formatInteger(totals.superchats)} 笔 SC
      </p>
    </section>
  );
}
