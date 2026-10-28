import {
  CalendarDays,
  Clock3,
  HandCoins,
  MessageSquare,
  Play,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardPanel } from "@/components/ui/card";
import type { DatasetTotals } from "@/lib/aggregate";
import {
  formatDurationLong,
  formatInteger,
  formatPercent,
} from "@/lib/format";

interface KpiGridProps {
  totals: DatasetTotals;
}

interface Kpi {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
}

export function KpiGrid({ totals }: KpiGridProps) {
  const topCurrency = totals.scByCurrency[0];
  const kpis: Kpi[] = [
    {
      label: "场次",
      value: formatInteger(totals.streamCount),
      hint: `${totals.memberOnlyCount} 场会员限定`,
      icon: CalendarDays,
    },
    {
      label: "总时长",
      value: formatDurationLong(totals.durationSec),
      hint: `平均 ${formatDurationLong(totals.durationSec / Math.max(1, totals.streamCount))}`,
      icon: Clock3,
    },
    {
      label: "弹幕",
      value: formatInteger(totals.chatTotal),
      hint: `${totals.avgChatPerMinute?.toFixed(1) ?? "—"} 条/分`,
      icon: MessageSquare,
    },
    {
      label: "SC",
      value: formatInteger(totals.chatByKind.superchat),
      hint: topCurrency
        ? `${topCurrency.currency} ${formatInteger(topCurrency.amount)} 起`
        : "无记录",
      icon: HandCoins,
    },
    {
      label: "播放",
      value: formatInteger(totals.views),
      hint: `${totals.withVstatsCount} 场有 VSTATS`,
      icon: Play,
    },
    {
      label: "视聴时间",
      value: `${formatInteger(totals.watchHours)} 人·时`,
      hint: `点赞率 ${formatPercent(
        totals.views > 0 ? (totals.likes / totals.views) * 100 : null,
        2,
      )}`,
      icon: Users,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {kpis.map(kpi => {
        const Icon = kpi.icon;
        return (
          <Card key={kpi.label}>
            <CardPanel className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs">{kpi.label}</span>
                <Icon aria-hidden="true" className="size-3.5 text-muted-foreground" />
              </div>
              <p className="mt-2 truncate font-heading font-semibold text-xl">{kpi.value}</p>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">{kpi.hint}</p>
            </CardPanel>
          </Card>
        );
      })}
    </div>
  );
}
