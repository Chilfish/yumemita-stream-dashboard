import type { CSSProperties } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { AppHeader } from '@/components/dashboard/app-header'
import { AppSidebar } from '@/components/dashboard/app-sidebar'
import { CommandPalette } from '@/components/dashboard/command-palette'
import { DatasetViewContext } from '@/components/dashboard/dataset-view-context'
import { MobileTabBar } from '@/components/dashboard/mobile-tab-bar'
import { AboutPage } from '@/components/pages/about-page'
import { GalleryPage } from '@/components/pages/gallery-page'
import { HomePage } from '@/components/pages/home-page'
import { StreamsPage } from '@/components/pages/streams-page'
import { TranscriptsPage } from '@/components/pages/transcripts-page'
import { TrendsPage } from '@/components/pages/trends-page'
import { CompareView } from '@/components/dashboard/compare-view'
import { StreamDetailView } from '@/components/dashboard/stream-detail-view'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import type { DatasetTotals } from '@/lib/aggregate'
import { memberAccent } from '@/lib/color'
import { rememberMember } from '@/lib/preferences'
import {
  parseCompareIds,
  parseStreamSubView,
  streamPath,
  toggleCompareId,
  type ViewKey,
} from '@/lib/routes'
import { RouterProvider, useNavigate, useSearchParams } from '@/lib/router-compat'
import type { StreamDatapack } from '@/types/datapack'
import type { BatchManifest, DatasetIndexEntry, StreamSummary } from '@/types/dataset'
import { useShellTheme } from './shell-theme'

export type DatasetView =
  | 'home'
  | 'streams'
  | 'trends'
  | 'gallery'
  | 'transcripts'
  | 'compare'
  | 'about'
  | 'stream'

export interface DatasetPageProps {
  datasets: DatasetIndexEntry[]
  dataset: DatasetIndexEntry
  manifest: BatchManifest
  rows: StreamSummary[]
  totals: DatasetTotals
  view: DatasetView
  section: ViewKey
  pathname: string
  search: string
  params: Record<string, string>
  stream: StreamSummary | null
  pack: StreamDatapack | null
  comparePacks: Record<string, StreamDatapack>
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
        chatTotal={totals.chatTotal}
        dataset={dataset}
        datasets={datasets}
        onToggleTheme={onToggleTheme}
        section={section}
        theme={theme}
      />

      <SidebarInset className="ambient-field min-w-0" id="main-content" tabIndex={-1}>
        <AppHeader
          chatTotal={totals.chatTotal}
          dataset={dataset}
          onOpenCommand={() => setCommandOpen(true)}
          section={section}
          stream={stream}
          streamCount={rows.length}
        />

        <div className="mx-auto w-full max-w-[82.5rem] px-4 pt-6 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:px-6 md:pb-6">
          <DatasetViewContext.Provider value={{ dataset, manifest: props.manifest, rows, totals }}>
            <div className="motion-view" key={`${dataset.id}/${section}`}>
              <DatasetBody {...props} />
            </div>
          </DatasetViewContext.Provider>
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
    case 'trends':
      return <TrendsPage />
    case 'gallery':
      return <GalleryPage />
    case 'transcripts':
      return <TranscriptsPage />
    case 'about':
      return <AboutPage />
    case 'compare':
      return <CompareBody {...props} />
    case 'stream':
      return <StreamBody {...props} />
  }
}

function StreamBody({ dataset, rows, stream, pack }: DatasetPageProps) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const view = parseStreamSubView(searchParams.get('view'))

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
      onSelect={nextId => navigate(streamPath(dataset.id, nextId))}
      onViewChange={next => navigate(streamPath(dataset.id, stream.videoId, next))}
      row={{ summary: stream, pack }}
      rows={rows}
      view={view}
    />
  )
}

function CompareBody({ dataset, rows, comparePacks }: DatasetPageProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const hasParam = searchParams.has('ids')
  const urlIds = parseCompareIds(searchParams.get('ids'))
  const validIds = urlIds.filter(id => rows.some(row => row.videoId === id))
  const selectedIds = hasParam ? validIds : rows.slice(0, 3).map(row => row.videoId)

  const writeIds = useCallback((ids: string[]) => {
    const params = new URLSearchParams(searchParams)
    params.set('ids', ids.join(','))
    setSearchParams(params, { replace: true })
  }, [searchParams, setSearchParams])

  return (
    <CompareView
      datasetLabel={dataset.label}
      onReset={() => writeIds([])}
      onToggle={videoId => writeIds(toggleCompareId(selectedIds, videoId))}
      packError={null}
      packStatus="ready"
      packs={new Map(Object.entries(comparePacks))}
      rows={rows}
      selectedIds={selectedIds.filter(id => id in comparePacks)}
    />
  )
}
