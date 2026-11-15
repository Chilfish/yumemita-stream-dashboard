import type { CSSProperties, ReactNode } from 'react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { AppHeader } from '@/components/dashboard/shell/app-header'
import { AppSidebar } from '@/components/dashboard/shell/app-sidebar'
import { DatasetViewContext } from '@/components/dashboard/contexts/dataset-view-context'
import { MobileTabBar } from '@/components/dashboard/shell/mobile-tab-bar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import { memberAccent } from '@/lib/color'
import { rememberMember } from '@/lib/preferences'
import { useNavigate } from '@/lib/router-compat'
import type { BatchManifest } from '@/types/dataset'
import type { DatasetAppProps } from './dataset-app-types'
import { useShellTheme } from './shell-theme'

// 命令面板只在 ⌘K 打开时渲染，先按需加载，避免把 autocomplete / dialog 塞进首屏包。
const CommandPalette = lazy(() =>
  import('@/components/dashboard/shell/command-palette').then(module => ({
    default: module.CommandPalette,
  })))

/**
 * 侧栏 + 页头 + 移动底栏。每个页面只把自己的视图作为 children 传进来，
 * 这样日历 / 相册这些视图不会被打进无关路由的 chunk。
 */
export function DatasetShell({
  dataset,
  datasets,
  rows,
  totals,
  navItems,
  section,
  stream,
  children,
}: DatasetAppProps & { children: ReactNode }) {
  const navigation = navItems ?? rows
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

  // Provider value 必须稳定：否则打开命令面板或切换主题会让正文与图表整页重算。
  const viewValue = useMemo(
    () => (totals ? { dataset, datasets, manifest, rows, totals } : null),
    [dataset, datasets, manifest, rows, totals],
  )

  useKeyboardShortcuts({
    datasetId: dataset.id,
    rows: navigation,
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
          streamCount={navigation.length}
        />

        <div className="mx-auto w-full max-w-[82.5rem] px-2 pt-6 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:px-6 md:pb-6">
          <div className="motion-view" key={`${dataset.id}/${section}`}>
            {viewValue
              ? <DatasetViewContext.Provider value={viewValue}>{children}</DatasetViewContext.Provider>
              : children}
          </div>
        </div>

        <MobileTabBar
          activeMemberId={dataset.id}
          activeSection={section}
          datasetId={dataset.id}
          datasets={datasets}
          latestVideoId={navigation[0]?.videoId ?? null}
          onMemberSelect={next => navigate(`/${next.id}`)}
        />

        {commandOpen ? (
          <Suspense fallback={null}>
            <CommandPalette
              datasetId={dataset.id}
              datasets={datasets}
              onOpenChange={setCommandOpen}
              open
              rows={navigation}
            />
          </Suspense>
        ) : null}
      </SidebarInset>
    </SidebarProvider>
  )
}
