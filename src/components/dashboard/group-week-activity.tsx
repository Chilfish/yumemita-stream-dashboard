import { formatInteger } from "@/lib/format";
import type { GroupMemberSummary } from "@/lib/group";
import { buildWeekActivity } from "@/lib/group-home";

interface GroupWeekActivityProps {
  members: GroupMemberSummary[];
}

/**
 * 一条 6px 的堆叠条 + 图例：谁这一周播得多一眼可见，但不抢 hero 的封面。
 * 只读 `weekStreams`（近 7 天，含今天，JST），口径与顶部脉冲一致。
 */
export function GroupWeekActivity({ members }: GroupWeekActivityProps) {
  const { total, entries, segments } = buildWeekActivity(members);

  return (
    <div className="border-t border-hairline px-5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="text-caption text-ink-3">本周活跃 · 近 7 天场次</h3>
        <p className="text-caption text-ink-3 tabular-nums">全组 {formatInteger(total)} 场</p>
      </div>

      {total === 0 ? (
        <p className="mt-1.5 text-caption text-muted-foreground">最近 7 天还没有人开播。</p>
      ) : (
        <>
          <ul
            aria-hidden="true"
            className="mt-2 flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
          >
            {segments.map(segment => (
              <li
                className="h-full first:rounded-s-full last:rounded-e-full"
                key={segment.id}
                style={{
                  backgroundColor: segment.color,
                  flexBasis: 0,
                  flexGrow: segment.streams,
                }}
              />
            ))}
          </ul>

          <ul className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-caption">
            {entries.map(entry => (
              <li className="flex items-baseline gap-1" key={entry.id}>
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 self-center rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span className={entry.streams > 0 ? "text-muted-foreground" : "text-ink-3"}>
                  {entry.label}
                </span>
                <span
                  className={
                    entry.streams > 0
                      ? "font-medium tabular-nums text-foreground"
                      : "tabular-nums text-ink-3"
                  }
                >
                  {entry.streams}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
