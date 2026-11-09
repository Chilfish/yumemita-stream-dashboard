import { Link } from "@/lib/router-compat";
import { useGroupDataContext } from "@/components/dashboard/contexts/group-data-context";
import { Panel, PanelBody, PanelHead } from "@/components/dashboard/primitives/panel";
import { StreamCover } from "@/components/dashboard/primitives/stream-cover";
import { galleryDayLabel } from "@/lib/gallery-params";
import { DEFAULT_MEMBER_COLOR } from "@/lib/group";
import { groupGalleryDayPath, streamPath } from "@/lib/routes";
import type { GroupStreamSummary } from "@/types/group";

interface GroupOnThisDayProps {
  /** JST 今天的 `MM-DD`。 */
  monthDay: string;
  /** 今天之前、同月日的场次，已按开播时间倒序。 */
  rows: GroupStreamSummary[];
}

/**
 * 组首页的「那年今日」摘要：只铺一屏封面，完整的跨年份列表交给相册 `?day=MM-DD`。
 * 没有往期场次时整块不渲染，不留空态。
 */
export function GroupOnThisDay({ monthDay, rows }: GroupOnThisDayProps) {
  const { members } = useGroupDataContext();
  if (!monthDay || rows.length === 0) return null;

  const datasetById = new Map(members.map(member => [member.dataset.id, member.dataset]));

  return (
    <Panel>
      <PanelHead
        eyebrow={galleryDayLabel(monthDay)}
        meta={`${rows.length} 场`}
        title={(
          <Link className="hover:text-member-ink" to={groupGalleryDayPath(monthDay)}>
            那年今日
          </Link>
        )}
      />
      <PanelBody className="pt-1" flush>
        <ul className="grid grid-cols-2 gap-3 px-5 pb-5 md:grid-cols-4 md:gap-4">
          {rows.map(row => {
            const dataset = datasetById.get(row.datasetId);
            const label = dataset?.label ?? row.datasetId;
            const color = dataset?.color ?? DEFAULT_MEMBER_COLOR;

            return (
              <li className="min-w-0" key={`${row.datasetId}/${row.videoId}`}>
                <Link
                  className="press group flex flex-col gap-2 rounded-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink"
                  to={streamPath(row.datasetId, row.videoId)}
                >
                  <StreamCover
                    className="transition-[filter] duration-120 ease-out group-hover:brightness-[1.06]"
                    datasetId={row.datasetId}
                    sizes="(min-width: 768px) 22vw, 45vw"
                    thumbnail={row.thumbnail}
                    title={row.title}
                    videoId={row.videoId}
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="flex min-w-0 items-center gap-x-2 text-caption text-muted-foreground">
                      <span className="shrink-0 tabular-nums">{row.date.slice(0, 4)} 年</span>
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <span
                          aria-hidden="true"
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        <span className="truncate">{label}</span>
                      </span>
                    </p>
                    <p className="line-clamp-2 text-body text-foreground transition-colors duration-120 ease-out group-hover:text-member-ink">
                      {row.title}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </PanelBody>
    </Panel>
  );
}
