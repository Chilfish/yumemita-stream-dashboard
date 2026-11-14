import { useMemo, useState } from "react";
import { Link } from "@/lib/router-compat";
import { MemberDot } from "@/components/dashboard/primitives/member-avatar";
import { Panel, PanelBody, PanelHead } from "@/components/dashboard/primitives/panel";
import { cn } from "@/lib/utils";
import {
  buildCollaborationPairs,
  collaborationPairKey,
  type CollaborationPair,
  type CollaborationStream,
} from "@/lib/collaboration";
import { formatFullDate } from "@/lib/format";
import type { GroupMemberSummary } from "@/lib/group";
import { streamPath } from "@/lib/routes";

/**
 * 热力只做底纹，数值始终写出来；最深一档也只有 12%，
 * 让网格线和数字比色块更显眼。
 */
const LEVEL_CLASSES = [
  "",
  "bg-foreground/[0.02]",
  "bg-foreground/[0.04]",
  "bg-foreground/[0.06]",
  "bg-foreground/[0.09]",
  "bg-foreground/[0.12]",
] as const;

const SELF_HATCH =
  "repeating-linear-gradient(135deg, transparent 0 3px, var(--hairline) 3px 4px)";

function levelOf(count: number, max: number): number {
  if (count <= 0) return 0;
  return Math.max(1, Math.min(5, Math.ceil((count / max) * 5)));
}

interface GroupCollaborationMatrixProps {
  collaborations: CollaborationStream[];
  members: GroupMemberSummary[];
}

/**
 * 组级联动关系：左侧紧凑矩阵，右侧当前组合的场次。
 * 行读本人、列读对方；默认展开次数最多的一对，避免右侧空着。
 */
export function GroupCollaborationMatrix({ collaborations, members }: GroupCollaborationMatrixProps) {
  const memberIds = useMemo(() => members.map(member => member.dataset.id), [members]);
  const labelOf = useMemo(
    () => new Map(members.map(member => [member.dataset.id, member.dataset.label])),
    [members],
  );
  const colorOf = useMemo(
    () => new Map(members.map(member => [member.dataset.id, member.dataset.color ?? "#b8461f"])),
    [members],
  );
  const pairs = useMemo(
    () => buildCollaborationPairs(collaborations, memberIds),
    [collaborations, memberIds],
  );
  const pairByKey = useMemo(
    () => new Map(pairs.map(pair => [collaborationPairKey(pair.a, pair.b), pair])),
    [pairs],
  );
  const max = Math.max(1, ...pairs.map(pair => pair.count));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hovered, setHovered] = useState<{ row: string; column: string } | null>(null);

  const activeKey = selectedKey ?? (pairs[0] ? collaborationPairKey(pairs[0].a, pairs[0].b) : null);
  const active = activeKey ? pairByKey.get(activeKey) ?? null : null;

  if (collaborations.length < 2) {
    return (
      <Panel>
        <PanelHead title="联动关系" />
        <PanelBody>
          <p className="text-caption text-muted-foreground">
            {collaborations.length === 0
              ? "还没有登记联动场次，等参与者写入后再看关系。"
              : "目前只登记了 1 场联动，等场次多起来再画矩阵。"}
          </p>
        </PanelBody>
      </Panel>
    );
  }

  function selectPair(pair: CollaborationPair): void {
    setSelectedKey(collaborationPairKey(pair.a, pair.b));
  }

  function cellState(rowId: string, columnId: string): boolean {
    return hovered?.row === rowId || hovered?.column === columnId;
  }

  return (
    <Panel>
      <PanelHead eyebrow="成员关系" title="联动关系" />
      <PanelBody flush>
        <div className="lg:grid lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] lg:divide-x lg:divide-hairline">
          <div className="min-w-0 px-3 pb-4 md:px-5">
            <div className="-mx-1 overflow-x-auto px-1">
              <table
                className="w-full max-w-[27.5rem] table-fixed border-collapse"
                onMouseLeave={() => setHovered(null)}
              >
                <caption className="sr-only">成员两两同场次数</caption>
                <colgroup>
                  <col className="w-[4.5rem] md:w-24" />
                  <col span={5} />
                </colgroup>
                <thead>
                  <tr>
                    <th
                      className="sticky left-0 border-b border-hairline bg-card pb-2.5"
                      scope="col"
                    />
                    {members.map(member => (
                      <th
                        className={cn(
                          "border-b border-hairline px-0 pb-2.5 text-center text-[9px] font-medium leading-[1.2] transition-colors duration-120 ease-out md:px-1 md:text-[11px]",
                          active &&
                            (active.a === member.dataset.id || active.b === member.dataset.id)
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                        key={member.dataset.id}
                        scope="col"
                      >
                        {member.dataset.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {members.map(row => (
                    <tr key={row.dataset.id}>
                      <th
                        className={cn(
                          "sticky left-0 z-10 border-b border-hairline bg-card py-2 pe-1 text-left text-[11px] font-medium transition-colors duration-120 ease-out md:pe-2 md:text-[12px]",
                          active &&
                            (active.a === row.dataset.id || active.b === row.dataset.id)
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                        scope="row"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <MemberDot color={colorOf.get(row.dataset.id) ?? "#b8461f"} />
                          <span className="truncate">{row.dataset.label}</span>
                        </span>
                      </th>
                      {members.map(column => {
                        if (column.dataset.id === row.dataset.id) {
                          return (
                            <td
                              className="border-b border-hairline p-0"
                              key={column.dataset.id}
                              onMouseEnter={() =>
                                setHovered({ row: row.dataset.id, column: column.dataset.id })
                              }
                            >
                              <div
                                aria-hidden="true"
                                className="h-11"
                                style={{ backgroundImage: SELF_HATCH }}
                              />
                            </td>
                          )
                        }

                        const key = collaborationPairKey(row.dataset.id, column.dataset.id);
                        const pair = pairByKey.get(key);
                        const isActive = key === activeKey;

                        return (
                          <td
                            className={cn(
                              "border-b border-hairline p-0 transition-colors duration-120 ease-out",
                              cellState(row.dataset.id, column.dataset.id) && "bg-foreground/[0.03]",
                            )}
                            key={column.dataset.id}
                            onMouseEnter={() =>
                              setHovered({ row: row.dataset.id, column: column.dataset.id })
                            }
                          >
                            {pair ? (
                              <button
                                aria-label={`${row.dataset.label} × ${column.dataset.label}：${pair.count} 场`}
                                aria-pressed={isActive}
                                className={cn(
                                  "flex h-11 w-full items-center justify-center text-footnote tabular-nums transition-colors duration-120 ease-out hover:bg-foreground/[0.05] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-member-ink",
                                  LEVEL_CLASSES[levelOf(pair.count, max)],
                                  isActive
                                    ? "font-semibold text-foreground shadow-[inset_0_0_0_1.5px_var(--foreground)]"
                                    : "font-medium text-foreground",
                                )}
                                onClick={() => selectPair(pair)}
                                onFocus={() =>
                                  setHovered({ row: row.dataset.id, column: column.dataset.id })
                                }
                                type="button"
                              >
                                {pair.count}
                              </button>
                            ) : (
                              <div className="flex h-11 items-center justify-center text-ink-3">—</div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="min-w-0 border-t border-hairline px-5 py-4 lg:border-t-0">
            {active ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-footnote font-medium text-foreground">
                    {labelOf.get(active.a) ?? active.a} × {labelOf.get(active.b) ?? active.b}
                  </h3>
                  <span className="text-caption tabular-nums text-ink-3">{active.count} 场</span>
                </div>
                <ul className="mt-2 max-h-64 divide-y divide-hairline overflow-y-auto lg:max-h-72">
                  {active.streams.map(stream => (
                    <li className="flex items-baseline gap-2 py-1.5 text-caption" key={stream.videoId}>
                      <span className="w-16 shrink-0 tabular-nums text-ink-3">
                        {formatFullDate(stream.date)}
                      </span>
                      <Link
                        className="min-w-0 flex-1 truncate text-foreground underline-offset-2 transition-colors duration-120 ease-out hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink"
                        to={streamPath(stream.ownerId, stream.videoId)}
                      >
                        {stream.title}
                      </Link>
                      <span className="shrink-0 text-ink-3">
                        {stream.memberCount > 2 ? `${stream.memberCount} 人` : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      </PanelBody>
    </Panel>
  );
}
