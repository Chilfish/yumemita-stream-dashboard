import { useMemo, type CSSProperties } from "react";
import { DataEmpty } from "@/components/dashboard/primitives/data-empty";
import { MemberDot } from "@/components/dashboard/primitives/member-avatar";
import { Panel } from "@/components/dashboard/primitives/panel";
import { formatInteger } from "@/lib/format";
import { ATTENDANCE_WINDOW_DAYS, type GroupMemberSummary } from "@/lib/group";
import { buildAttendance } from "@/lib/group-home";
import type { GroupDayStat } from "@/types/group";

const OPACITY = [0, 0.18, 0.36, 0.56, 0.76, 1] as const;
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

interface GroupMemberPanelProps {
  members: GroupMemberSummary[];
  days: GroupDayStat[];
  attendanceStart: string | null;
  attendanceEnd: string | null;
}

/**
 * 近 100 天出勤。数据来自 group summary，只在本地重算，不触发新的查询；
 * 场次含会限，其余指标只累加公开场次。
 */
export function GroupMemberPanel({
  members,
  days,
  attendanceStart,
  attendanceEnd,
}: GroupMemberPanelProps) {
  const attendance = useMemo(
    () =>
      attendanceStart && attendanceEnd
        ? buildAttendance(members, days, attendanceStart, attendanceEnd)
        : null,
    [attendanceEnd, attendanceStart, days, members],
  );

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
      ) : (
        // 出勤算不出来时不要再留一张空白卡片：说明缺什么、什么条件下会出现。
        <DataEmpty
          hint={
            attendanceEnd
              ? `${ATTENDANCE_WINDOW_DAYS} 天窗口内还没有场次时，这里会是空的。`
              : undefined
          }
          message="还没有足够的开播记录"
        />
      )}
    </Panel>
  );
}
