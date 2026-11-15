import { TriangleAlert } from 'lucide-react'
import type { DatasetAppProps } from '@/components/app/dataset-app-types'
import { DatasetShell } from '@/components/app/dataset-shell'
import { LockedStreamView } from '@/components/dashboard/stream/locked-stream-view'
import { StreamDetailView } from '@/components/dashboard/stream/stream-detail-view'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { memberLabelsOf } from '@/lib/members'
import { DEFAULT_STREAM_SUBVIEW, parseStreamSubView, streamPath } from '@/lib/routes'
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
  const view = parseStreamSubView(searchParams.get('view'))

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
      view={view}
    />
  )
}
