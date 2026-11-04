import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PackStatus } from '@/types/datapack'
import { TriangleAlert } from 'lucide-react'
import { AppHeader } from '@/components/dashboard/app-header'
import { AppSidebar } from '@/components/dashboard/app-sidebar'
import { CommandPalette } from '@/components/dashboard/command-palette'
import { DatasetViewContext } from '@/components/dashboard/dataset-view-context'
import { MobileTabBar } from '@/components/dashboard/mobile-tab-bar'
import { CalendarPage } from '@/components/pages/calendar-page'
import { GalleryPage } from '@/components/pages/gallery-page'
import { HomePage } from '@/components/pages/home-page'
import { StreamsPage } from '@/components/pages/streams-page'
import { TranscriptsPage } from '@/components/pages/transcripts-page'
import { TrendsPage } from '@/components/pages/trends-page'
import { CompareView } from '@/components/dashboard/compare-view'
import { LockedStreamView } from '@/components/dashboard/locked-stream-view'
import { StreamDetailView } from '@/components/dashboard/stream-detail-view'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import type { DatasetTotals } from '@/lib/aggregate'
import { memberAccent } from '@/lib/color'
import { rememberMember } from '@/lib/preferences'
import { isMemberOnly } from '@/lib/visibility'
import {
  DEFAULT_STREAM_SUBVIEW,
  parseCompareIds,
  parseStreamSubView,
  streamPath,
  toggleCompareId,
  type ViewKey,
} from '@/lib/routes'
import { RouterProvider, useNavigate, useSearchParams } from '@/lib/router-compat'
import type { TranscriptIndexEntry } from '@/lib/transcripts'
import type { CalendarPageData } from '@/types/calendar'
import type { StreamDatapack } from '@/types/datapack'
import type { BatchManifest, DatasetIndexEntry, StreamSummary } from '@/types/dataset'
import { useShellTheme } from './shell-theme'

export type DatasetView =
  | 'home'
  | 'streams'
  | 'calendar'
  | 'trends'
  | 'gallery'
  | 'transcripts'
  | 'compare'
  | 'stream'

export interface DatasetPageProps {
  datasets: DatasetIndexEntry[]
  dataset: DatasetIndexEntry
  rows: StreamSummary[]
  /** 日历页不读全量 pack，因此允许为空；正文也不需要 `DatasetViewContext`。 */
  totals: DatasetTotals | null
  calendar?: CalendarPageData | null
  view: DatasetView
  section: ViewKey
  pathname: string
  search: string
  params: Record<string, string>
  stream: StreamSummary | null
  pack: StreamDatapack | null
  comparePacks: Record<string, StreamDatapack>
  transcripts?: TranscriptIndexEntry[]
  transcriptError?: string | null
  hasTranscript?: boolean
  /** 会员限定单场：复用详情页外壳，正文换成公开范围说明。 */
  locked?: boolean
}

export function DatasetPage(props: DatasetPageProps) {
  return (
    <RouterProvider pathname={props.pathname} search={props.search} params={props.params}>
      <DatasetShell {...props} />
    </RouterProvider>
  )
}

function DatasetShell(props: DatasetPageProps) {
  const { dataset, datasets, rows, totals, section, stream } = props
  const { theme, onToggleTheme } = useShellTheme()
  const navigate = useNavigate()
  const [commandOpen, setCommandOpen] = useState(false)

  const memberColor = dataset.color ?? '#b8461f'
  const memberInk = memberAccent(memberColor, theme)

  // manifest 与 rows 是同一份数据，放进岛屿只会让 HTML 翻倍；这里从 rows 就地组装。
  const manifest = useMemo<BatchManifest>(() => ({
    schema: 'yumemita.stream-datapack.batch/v1',
    generatedAt: dataset.generatedAt ?? rows[0]?.generatedAt ?? '',
    subject: dataset.id,
    channelId: dataset.channelId,
    scope: '',
    count: rows.length,
    note: '',
    streams: rows,
  }), [dataset, rows])

  useKeyboardShortcuts({
    datasetId: dataset.id,
    rows,
    onCommandPalette: () => setCommandOpen(true),
  })

  useEffect(() => {
    rememberMember(dataset.id)
  }, [dataset.id])

  return (
    <SidebarProvider
      style={
        {
          '--member-color': memberColor,
          '--member-ink': memberInk,
          '--ambient-accent': memberInk,
        } as CSSProperties
      }
    >
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-card focus:px-3 focus:py-2 focus:text-footnote focus:shadow-surface"
        href="#main-content"
      >
        跳到主要内容
      </a>
      <AppSidebar
        chatTotal={totals?.chatTotal ?? null}
        dataset={dataset}
        datasets={datasets}
        onToggleTheme={onToggleTheme}
        section={section}
        theme={theme}
      />

      <SidebarInset className="ambient-field min-w-0" id="main-content" tabIndex={-1}>
        <AppHeader
          chatTotal={totals?.chatTotal ?? null}
          dataset={dataset}
          onOpenCommand={() => setCommandOpen(true)}
          section={section}
          stream={stream}
          streamCount={rows.length}
        />

        <div className="mx-auto w-full max-w-[82.5rem] px-4 pt-6 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:px-6 md:pb-6">
          <div className="motion-view" key={`${dataset.id}/${section}`}>
            {totals
              ? (
                  <DatasetViewContext.Provider value={{ dataset, manifest, rows, totals }}>
                    <DatasetBody {...props} />
                  </DatasetViewContext.Provider>
                )
              : <DatasetBody {...props} />}
          </div>
        </div>

        <MobileTabBar
          activeMemberId={dataset.id}
          activeSection={section}
          datasetId={dataset.id}
          datasets={datasets}
          latestVideoId={rows[0]?.videoId ?? null}
          onMemberSelect={next => navigate(`/${next.id}`)}
        />

        <CommandPalette
          datasetId={dataset.id}
          datasets={datasets}
          onOpenChange={setCommandOpen}
          open={commandOpen}
          rows={rows}
        />
      </SidebarInset>
    </SidebarProvider>
  )
}

function DatasetBody(props: DatasetPageProps) {
  switch (props.view) {
    case 'home':
      return <HomePage />
    case 'streams':
      return <StreamsPage />
    case 'calendar':
      return <CalendarPage data={props.calendar ?? null} basePath={props.pathname} />
    case 'trends':
      return <TrendsPage />
    case 'gallery':
      return <GalleryPage />
    case 'transcripts':
      return (
        <TranscriptsPage
          error={props.transcriptError ?? null}
          transcripts={props.transcripts ?? []}
        />
      )
    case 'compare':
      return <CompareBody {...props} />
    case 'stream':
      return <StreamBody {...props} />
  }
}

function StreamBody({ dataset, rows, stream, pack, hasTranscript, locked }: DatasetPageProps) {
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
      datasetId={dataset.id}
      hasTranscript={hasTranscript ?? false}
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

function CompareBody({ dataset, rows, comparePacks }: DatasetPageProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [packs, setPacks] = useState(() => new Map(Object.entries(comparePacks)))
  const [status, setStatus] = useState<PackStatus>('ready')
  const [packError, setPackError] = useState<string | null>(null)

  const hasParam = searchParams.has('ids')
  const urlIds = parseCompareIds(searchParams.get('ids'))
  const validIds = urlIds.filter(id => rows.some(row => row.videoId === id))
  const selectedIds = hasParam ? validIds : rows.slice(0, 3).map(row => row.videoId)
  const selectedKey = selectedIds.join(',')
  // 带 key 访问时会员限定场的 pack 也放行；否则跳过它们，避免 404 拖垮整页曲线。
  const accessKey = searchParams.get('key')
  const accessSuffix = accessKey ? `?key=${encodeURIComponent(accessKey)}` : ''

  const writeIds = useCallback((ids: string[]) => {
    const params = new URLSearchParams(searchParams)
    params.set('ids', ids.join(','))
    setSearchParams(params, { replace: true })
  }, [searchParams, setSearchParams])

  // 切换对比场次时只按需拉缺失的 pack，首屏已经带上的不再请求。
  useEffect(() => {
    const missing = (selectedKey ? selectedKey.split(',') : []).filter((id) => {
      if (packs.has(id)) return false
      if (accessKey) return true
      const row = rows.find(item => item.videoId === id)
      return !isMemberOnly(row?.availability)
    })
    if (missing.length === 0) return

    let cancelled = false
    // oxlint-disable-next-line react/set-state-in-effect -- 选择变化后要立刻显示加载态
    setStatus('loading')
    setPackError(null)

    Promise.all(
      missing.map(async videoId => {
        const response = await fetch(
          `/api/packs/${encodeURIComponent(dataset.id)}/${encodeURIComponent(videoId)}${accessSuffix}`,
        )
        if (!response.ok) throw new Error(`加载 ${videoId} 失败`)
        return [videoId, (await response.json()) as StreamDatapack] as const
      }),
    )
      .then((entries) => {
        if (cancelled) return
        setPacks((previous) => {
          const next = new Map(previous)
          for (const [videoId, pack] of entries) next.set(videoId, pack)
          return next
        })
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setPackError(error instanceof Error ? error.message : String(error))
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [accessKey, accessSuffix, dataset.id, packs, rows, selectedKey])

  return (
    <CompareView
      datasetLabel={dataset.label}
      onReset={() => writeIds([])}
      onToggle={videoId => writeIds(toggleCompareId(selectedIds, videoId))}
      packError={packError}
      packStatus={status}
      packs={packs}
      rows={rows}
      selectedIds={selectedIds}
    />
  )
}
