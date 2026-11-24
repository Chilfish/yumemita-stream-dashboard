import { TriangleAlert } from 'lucide-react'
import type { DatasetAppProps } from '@/components/app/dataset-app-types'
import { DatasetShell } from '@/components/app/dataset-shell'
import { LockedStreamView } from '@/components/dashboard/stream/locked-stream-view'
import { StreamDetailView } from '@/components/dashboard/stream/stream-detail-view'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { memberLabelsOf } from '@/lib/members'
import { pickDefaultStreamSubView, resolveChatAvailability } from '@/lib/data-availability'
import { DEFAULT_STREAM_SUBVIEW, parseStreamSubView, streamPath, type StreamSubView } from '@/lib/routes'
import { RouterProvider, useNavigate, useSearchParams } from '@/lib/router-compat'

export function StreamApp(props: DatasetAppProps) {
  return (
    <RouterProvider params={props.params} pathname={props.pathname} search={props.search}>
      <DatasetShell {...props}>
        <StreamBody {...props} />
      </DatasetShell>
    </RouterProvider>
  )
}

function StreamBody({
  datasets,
  dataset,
  rows,
  stream,
  pack,
  hasTranscript,
  initialTranscript,
  locked,
}: DatasetAppProps) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const viewParam = searchParams.get('view')
  const view = parseStreamSubView(viewParam)

  if (locked && stream) {
    return <LockedStreamView datasetId={dataset.id} summary={stream} />
  }

  if (!stream || !pack) {
    return (
      <Alert variant="error">
        <TriangleAlert aria-hidden="true" />
        <AlertTitle>找不到这场直播</AlertTitle>
        <AlertDescription>它可能已被删除，或从未被本站收录。</AlertDescription>
      </Alert>
    )
  }

  // 没带 ?view 时按数据决定首屏：没有弹幕可看就落到评论，有弹幕仍停在概览。
  // URL 显式给出 view 时一率尊重，避免用户的选择被覆盖。
  const chatAvailability = resolveChatAvailability({
    availability: pack.video.availability,
    hasLiveChatReplay: pack.video.hasLiveChatReplay,
    liveStatus: pack.video.liveStatus,
    total: pack.chat.total,
  })
  const resolvedView: StreamSubView = viewParam
    ? view
    : pickDefaultStreamSubView({
        chatAvailable: chatAvailability.state === 'available',
        hasComments: (pack.comments?.items.length ?? 0) > 0,
      })

  return (
    <StreamDetailView
      // 联动场从参与者页进来时，封面、表情这些资源仍按频道主取。
      datasetId={stream.datasetId ?? dataset.id}
      hasTranscript={hasTranscript ?? false}
      initialTranscript={initialTranscript ?? null}
      memberLabels={memberLabelsOf(stream, datasets)}
      onSelect={nextId => navigate(streamPath(dataset.id, nextId))}
      onViewChange={(next) => {
        const params = new URLSearchParams(searchParams)
        if (next === DEFAULT_STREAM_SUBVIEW) params.delete('view')
        else params.set('view', next)
        setSearchParams(params, { replace: true })
      }}
      row={{ summary: stream, pack }}
      rows={rows}
      view={resolvedView}
    />
  )
}
