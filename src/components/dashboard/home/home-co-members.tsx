import { useMemo } from "react";
import { MemberDot } from "@/components/dashboard/primitives/member-avatar";
import { Panel, PanelBody, PanelHead } from "@/components/dashboard/primitives/panel";
import { buildCollaborationPairs, collaborationPartners } from "@/lib/collaboration";
import { formatDate, formatInteger, formatPercent } from "@/lib/format";
import type { DatasetIndexEntry, StreamSummary } from "@/types/dataset";

interface HomeCoMembersProps {
  datasetId: string;
  datasets: DatasetIndexEntry[];
  rows: StreamSummary[];
  /** 本人全部场次（owner ∪ 参与者），用于算占比。 */
  totalStreams: number;
}

/**
 * 「同场成员」只回答「这位成员常和谁一起播」。
 * 主数字是同场次数；0 次的组合显式写 —，与无数据区分。
 */
export function HomeCoMembers({ datasetId, datasets, rows, totalStreams }: HomeCoMembersProps) {
  const memberIds = useMemo(() => datasets.map(dataset => dataset.id), [datasets]);
  const pairs = useMemo(() => buildCollaborationPairs(rows, memberIds), [rows, memberIds]);
  const partners = useMemo(
    () => collaborationPartners(datasetId, pairs, memberIds),
    [datasetId, pairs, memberIds],
  );
  const memberById = useMemo(
    () => new Map(datasets.map(dataset => [dataset.id, dataset])),
    [datasets],
  );
  const hasAny = partners.some(partner => partner.count > 0);

  return (
    <Panel>
      <PanelHead eyebrow="联动" title="同场成员" />
      <PanelBody>
        {hasAny ? null : (
          <p className="mb-2 text-caption text-muted-foreground">还没有登记的同场场次。</p>
        )}
        <ul className="flex flex-col gap-2.5">
          {partners.map(partner => {
            const member = memberById.get(partner.otherId);
            const color = member?.color ?? "#b8461f";
            return (
              <li
                className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-0.5"
                key={partner.otherId}
              >
                <span className="flex min-w-0 items-center gap-1.5 text-body text-foreground">
                  <MemberDot color={color} />
                  <span className="truncate">{member?.label ?? partner.otherId}</span>
                </span>
                <span className="shrink-0 text-footnote font-medium tabular-nums text-foreground">
                  {partner.count === 0 ? "—" : `${formatInteger(partner.count)} 场`}
                </span>
                <span className="col-span-2 text-caption text-ink-3">
                  {partner.recentDate
                    ? `最近 ${formatDate(partner.recentDate)} · 占本人场次 ${formatPercent(
                        totalStreams > 0 ? (partner.count / totalStreams) * 100 : null,
                        1,
                      )}`
                    : "没有同场记录"}
                </span>
              </li>
            );
          })}
        </ul>
      </PanelBody>
    </Panel>
  );
}
