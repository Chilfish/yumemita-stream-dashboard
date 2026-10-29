import { Link } from "react-router";
import { DataTable, type DataColumn } from "@/components/dashboard/data-table";
import { Panel, PanelBody, PanelHead, PanelNote } from "@/components/dashboard/panel";
import { StreamList } from "@/components/dashboard/stream-list";
import { CONTENT_TYPE_LABELS, classifyTitle } from "@/lib/classify";
import { formatDate, formatDuration, formatInteger } from "@/lib/format";
import { streamsPath, streamPath } from "@/lib/routes";
import type { StreamSummary } from "@/types/dataset";

const RECENT_LIMIT = 8;

interface HomeRecentStreamsProps {
  datasetId: string;
  rows: StreamSummary[];
}

export function HomeRecentStreams({ datasetId, rows }: HomeRecentStreamsProps) {
  const recent = rows.slice(0, RECENT_LIMIT);

  const columns: DataColumn<StreamSummary>[] = [
    {
      header: "日期",
      key: "date",
      render: row => (
        <span className="tabular-nums text-muted-foreground">{formatDate(row.startedAt)}</span>
      ),
    },
    {
      cellClassName: "max-w-[13rem] sm:max-w-[22rem]",
      header: "场次",
      key: "title",
      render: row => <span className="block truncate text-foreground">{row.title}</span>,
    },
    {
      header: "类型",
      key: "type",
      render: row => {
        const { key, matched } = classifyTitle(row.title);
        return <span className={matched ? "text-muted-foreground" : "text-ink-3"}>{CONTENT_TYPE_LABELS[key]}</span>;
      },
      width: "4.5rem",
    },
    {
      align: "right",
      header: "时长",
      key: "duration",
      render: row => formatDuration(row.durationSec),
    },
    {
      align: "right",
      header: "平均",
      key: "avg",
      render: row => formatInteger(row.avgConcurrent),
    },
    {
      align: "right",
      header: "峰值",
      key: "max",
      render: row => formatInteger(row.maxConcurrent),
    },
    {
      align: "right",
      header: "弹幕",
      key: "chat",
      render: row => formatInteger(row.chatTotal),
    },
    {
      align: "right",
      header: "SC",
      key: "sc",
      render: row => formatInteger(row.superchats),
    },
  ];

  return (
    <Panel>
      <PanelHead meta={`最近 ${recent.length} 场，按开播时间倒序`} title="最近场次" />
      <PanelBody className="px-0 pb-0 md:px-3">
        <StreamList
          className="md:hidden"
          datasetId={datasetId}
          empty="没有加载到场次"
          rows={recent}
        />
        <div className="hidden md:block">
          <DataTable
            ariaLabel="最近场次"
            columns={columns}
            empty="没有加载到场次"
            rowHref={row => streamPath(datasetId, row.videoId)}
            rowKey={row => row.videoId}
            rowLabel={row => `打开单场：${row.title}`}
            rows={recent}
          />
        </div>
      </PanelBody>
      <PanelNote>
        <Link
          className="text-muted-foreground transition-colors duration-120 ease-out hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member"
          to={streamsPath(datasetId)}
        >
          完整表格与筛选 →
        </Link>
      </PanelNote>
    </Panel>
  );
}
