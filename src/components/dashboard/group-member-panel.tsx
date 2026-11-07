import { useMemo, useState, type CSSProperties } from "react";
import { MemberDot } from "@/components/dashboard/member-avatar";
import { Panel, PanelBody, PanelHead, PanelNote } from "@/components/dashboard/panel";
import { Meter, MeterIndicator, MeterTrack } from "@/components/ui/meter";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDecimal, formatInteger, formatPercent } from "@/lib/format";
import type { GroupMemberSummary } from "@/lib/group";
import {
  buildAttendance,
  buildMemberStandings,
  MEMBER_METRICS,
  memberMetric,
  type MemberMetricKey,
  type MemberMetricOption,
} from "@/lib/group-home";
import type { GroupDayStat } from "@/types/group";

const OPACITY = [0, 0.18, 0.36, 0.56, 0.76, 1] as const;
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

interface GroupMemberPanelProps {
  members: GroupMemberSummary[];
  days: GroupDayStat[];
  attendanceStart: string | null;
  attendanceEnd: string | null;
}

function formatMetricValue(value: number | null, option: MemberMetricOption): string {
  if (value == null) return "—";
  if (option.key === "duration") return formatDecimal(Math.round(value * 10) / 10);
  return option.format === "decimal" ? formatDecimal(value) : formatInteger(value);
}

/**
 * 成员榜 + 近 100 天出勤。两组数据都来自 group summary，切换指标只在本地重算，
 * 不触发新的查询；场次含会限，其余指标只累加公开场次。
 */
export function GroupMemberPanel({
  members,
  days,
  attendanceStart,
  attendanceEnd,
}: GroupMemberPanelProps) {
  const [metric, setMetric] = useState<MemberMetricKey>("streams");
  const active = memberMetric(metric);
  const standings = useMemo(() => buildMemberStandings(members, metric), [members, metric]);
  const maxValue = Math.max(1, standings.find(row => row.value != null)?.value ?? 0);
  const attendance = useMemo(
    () =>
      attendanceStart && attendanceEnd
        ? buildAttendance(members, days, attendanceStart, attendanceEnd)
        : null,
    [attendanceEnd, attendanceStart, days, members],
  );

  function changeMetric(next: string[]): void {
    const [value] = next;
    const option = MEMBER_METRICS.find(item => item.key === value);
    if (option) setMetric(option.key);
  }

  return (
    <Panel>
      {attendance && attendance.weeks > 0 ? (
        <div className="border-hairline px-5 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <h3 className="text-caption text-ink-3">近 {attendance.days} 天出勤</h3>
            <p className="text-caption text-ink-3 tabular-nums">
              {attendance.start} – {attendance.end} · {formatInteger(attendance.totalStreams)} 场
            </p>
          </div>

          <ul className="mt-3 grid grid-cols-1 gap-x-4 gap-y-4 [--attendance-cell:9px] min-[360px]:grid-cols-2 min-[360px]:[--attendance-cell:7px] min-[520px]:grid-cols-3 sm:[--attendance-cell:8px] md:grid-cols-4 lg:grid-cols-4 lg:gap-x-6 lg:[--attendance-cell:9px] xl:grid-cols-5 xl:[--attendance-cell:10px]">
            {attendance.rows.map(row => (
              <li key={row.id} style={{ "--member-color": row.color } as CSSProperties}>
                <div className="flex items-baseline justify-between gap-3 text-caption">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <MemberDot color={row.color} />
                    <span className="truncate font-medium text-muted-foreground">{row.label}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-3">
                    {formatInteger(row.totalStreams)} 场
                  </span>
                </div>

                <div
                  className="mt-1.5 grid gap-x-1.5"
                  style={{ gridTemplateColumns: "0.625rem auto" }}
                >
                  <div aria-hidden="true" />
                  <div
                    aria-hidden="true"
                    className="mb-[2px] grid gap-[2px] text-[9px] leading-[11px] text-ink-3"
                    style={{
                      gridTemplateColumns: `repeat(${attendance.weeks}, var(--attendance-cell))`,
                    }}
                  >
                    {attendance.axis.map(item => (
                      <span
                        className="whitespace-nowrap"
                        key={`${item.label}-${item.week}`}
                        style={{ gridColumnStart: item.week + 1 }}
                      >
                        {item.label}
                      </span>
                    ))}
                  </div>

                  <div
                    aria-hidden="true"
                    className="grid gap-[2px] text-[7px] text-ink-3"
                    style={{
                      gridTemplateRows: "repeat(7, var(--attendance-cell))",
                      lineHeight: "var(--attendance-cell)",
                    }}
                  >
                    {WEEKDAY_LABELS.map(label => (
                      <span key={label} style={{ height: "var(--attendance-cell)" }}>
                        {label}
                      </span>
                    ))}
                  </div>

                  <div
                    aria-label={`${row.label} ${attendance.start} 至 ${attendance.end} 出勤：${formatInteger(row.totalStreams)} 场`}
                    className="grid gap-[2px]"
                    role="img"
                    style={{
                      gridAutoFlow: "column",
                      gridTemplateColumns: `repeat(${attendance.weeks}, var(--attendance-cell))`,
                      gridTemplateRows: "repeat(7, var(--attendance-cell))",
                    }}
                  >
                    {row.cells.map((cell, index) => {
                      if (!cell) {
                        return <span aria-hidden="true" key={`empty-${index}`} />;
                      }
                      const level =
                        cell.streams === 0
                          ? 0
                          : Math.max(
                              1,
                              Math.min(5, Math.ceil((cell.streams / attendance.maxStreams) * 5)),
                            );
                      return (
                        <span
                          aria-hidden="true"
                          className="rounded-[2px]"
                          key={cell.date}
                          style={{
                            backgroundColor: level === 0 ? "var(--hairline)" : row.color,
                            opacity: level === 0 ? 1 : OPACITY[level],
                          }}
                          title={
                            cell.streams === 0
                              ? `${cell.date}：没有开播`
                              : `${cell.date}：${cell.streams} 场 · ${formatInteger(cell.chat)} 条弹幕`
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {attendance.totalStreams === 0 ? (
            <p className="mt-2 text-caption text-muted-foreground">
              最近 {attendance.days} 天还没有开播记录，可以到全组相册查看更早的场次。
            </p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
