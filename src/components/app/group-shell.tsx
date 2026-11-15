import type { ReactNode } from 'react'
import { AppSidebar } from '@/components/dashboard/shell/app-sidebar'
import { GroupHeader } from '@/components/dashboard/shell/group-header'
import { MobileTabBar } from '@/components/dashboard/shell/mobile-tab-bar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { homePath } from '@/lib/routes'
import { useNavigate } from '@/lib/router-compat'
import type { GroupAppProps } from './group-app-types'
import { useShellTheme } from './shell-theme'

/**
 * 群组页的侧栏 + 页头 + 移动底栏。视图由各路由的 entry 作为 children 传入，
 * 相册 / 对比这些重视图不会被打进无关路由的 chunk。
 */
export function GroupShell({
  datasets,
  data,
  compare,
  calendar,
  section,
  children,
}: GroupAppProps & { children: ReactNode }) {
  const { theme, onToggleTheme } = useShellTheme()
  const navigate = useNavigate()
  const allBuckets = compare?.buckets.filter(bucket => bucket.type === 'all') ?? []
  const calendarStreamCount = calendar?.members.reduce(
    (total, member) => total + member.streamCount,
    0,
  ) ?? 0
  const streamCount = section === 'calendar'
    ? calendarStreamCount
    : data?.totals.streamCount ?? allBuckets.reduce((total, bucket) => total + bucket.streams, 0)
  const chatTotal = section === 'calendar'
    ? null
    : data?.totals.chatTotal ?? allBuckets.reduce((total, bucket) => total + bucket.chatTotal, 0)

  return (
    <SidebarProvider>
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-card focus:px-3 focus:py-2 focus:text-footnote focus:shadow-surface"
        href="#main-content"
      >
        跳到主要内容
      </a>
      <AppSidebar
        chatTotal={chatTotal}
        dataset={null}
        datasets={datasets}
        onToggleTheme={onToggleTheme}
        section={section}
        theme={theme}
      />

      <SidebarInset className="ambient-field min-w-0" id="main-content" tabIndex={-1}>
        <GroupHeader
          chatTotal={chatTotal}
          memberCount={datasets.length}
          section={section}
          streamCount={streamCount}
        />

        <div className="mx-auto w-full max-w-[82.5rem] px-2 pt-6 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:px-6 md:pb-6">
          <div className="motion-view" key={section}>
            {children}
          </div>
        </div>

        <MobileTabBar
          activeMemberId={null}
          activeSection={section}
          datasetId={null}
          datasets={datasets}
          latestVideoId={null}
          onMemberSelect={member => navigate(homePath(member.id))}
        />
      </SidebarInset>
    </SidebarProvider>
  )
}
