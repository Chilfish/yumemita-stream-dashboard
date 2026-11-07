import { ExternalLink } from "lucide-react";
import { Link } from "@/lib/router-compat";
import { CopyLinkButton } from "@/components/dashboard/primitives/copy-link-button";
import { PageHeader } from "@/components/dashboard/primitives/page-header";
import { Panel } from "@/components/dashboard/primitives/panel";
import { StreamCover } from "@/components/dashboard/primitives/stream-cover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDuration, formatFullDate, formatTime, formatWeekday } from "@/lib/format";
import { streamsPath } from "@/lib/routes";
import type { StreamSummary } from "@/types/dataset";

interface LockedStreamViewProps {
  datasetId: string;
  summary: StreamSummary;
}

/**
 * 会员限定单场：沿用普通单场详情的页头 / 封面 / 面板布局，
 * 只把子视图与指标替换成公开范围说明。
 */
export function LockedStreamView({ datasetId, summary }: LockedStreamViewProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <PageHeader
          actions={
            <>
              <CopyLinkButton />
              <Button
                render={<a href={summary.url} rel="noreferrer" target="_blank" />}
                size="sm"
                variant="outline"
              >
                <ExternalLink aria-hidden="true" />
                YouTube
              </Button>
            </>
          }
          className="min-w-0 border-b-0 pb-0 lg:border-b lg:pb-4"
          eyebrow={`${formatFullDate(summary.startedAt)} ${formatWeekday(summary.startedAt)} · ${formatTime(summary.startedAt)} JST`}
          facts={[{ label: "时长", value: formatDuration(summary.durationSec) }]}
          title={summary.title}
          titleClassName="text-title line-clamp-2"
        >
          <Badge variant="warning">会员限定</Badge>
        </PageHeader>

        <StreamCover
          datasetId={datasetId}
          eager
          sizes="(min-width: 1024px) 20rem, 100vw"
          thumbnail={summary.thumbnail}
          title={summary.title}
          videoId={summary.videoId}
        />
      </div>

      <Panel className="p-4 md:p-5">
        <div className="flex max-w-2xl flex-col gap-3">
          <h2 className="text-headline text-foreground">这场直播的明细不公开</h2>
          <p className="text-body text-muted-foreground">
            本站只展示封面、标题与时间，不公开弹幕、SC、评论与统计数据。
          </p>
          <p className="text-footnote text-muted-foreground">
            公开范围与数据来源见{" "}
            <a
              className="text-member-ink underline-offset-2 hover:underline"
              href="/about"
            >
              说明
            </a>
            。
          </p>
          <div>
            <Button render={<Link to={streamsPath(datasetId)} />} size="sm" variant="outline">
              查看全部场次
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
