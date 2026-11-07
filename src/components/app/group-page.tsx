import { AppSidebar } from '@/components/dashboard/app-sidebar'
import { GroupDataContext } from '@/components/dashboard/group-data-context'
import { GroupHeader } from '@/components/dashboard/group-header'
import { MobileTabBar } from '@/components/dashboard/mobile-tab-bar'
import { GroupCalendarPage } from '@/components/pages/group-calendar-page'
import { GroupComparePage } from '@/components/pages/group-compare-page'
import { GroupGalleryPage } from '@/components/pages/group-gallery-page'
import { GroupAboutPage } from '@/components/pages/group-about-page'
import { GroupHomePage } from '@/components/pages/group-home-page'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { homePath, type GroupViewKey } from '@/lib/routes'
import { RouterProvider, useNavigate } from '@/lib/router-compat'
import type { GroupData } from '@/lib/group'
import type { CalendarPageData, DayPlan } from '@/types/calendar'
import type { GroupCompareData } from '@/types/compare'
import type { DatasetIndexEntry } from '@/types/dataset'
import { useShellTheme } from './shell-theme'

export type GroupView = 'home' | 'gallery' | 'about' | 'compare' | 'calendar'

export interface GroupPageProps {
  datasets: DatasetIndexEntry[]
  data: GroupData | null
  compare: GroupCompareData | null
  calendar?: CalendarPageData | null
  dayPlan?: DayPlan | null
  view: GroupView
  section: GroupViewKey
  pathname: string
  search: string
  params: Record<string, string>
}

export function GroupPage(props: GroupPageProps) {
  return (
    <RouterProvider pathname={props.pathname} search={props.search} params={props.params}>
      <GroupShell {...props} />
    </RouterProvider>
  )
}

function GroupShell({ datasets, data, compare, calendar, dayPlan, section, pathname }: GroupPageProps) {
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

        <div className="mx-auto w-full max-w-[82.5rem] px-4 pt-6 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:px-6 md:pb-6">
          <div className="motion-view" key={section}>
            {section === 'compare' && compare
              ? <GroupComparePage data={compare} datasets={datasets} />
              : section === 'calendar' && calendar
                ? <GroupCalendarPage basePath={pathname} calendar={calendar} />
                : data
                  ? (
                    <GroupDataContext.Provider value={data}>
                      {section === 'about'
                        ? <GroupAboutPage />
                        : section === 'gallery'
                          ? <GroupGalleryPage />
                          : <GroupHomePage dayPlan={dayPlan} />}
                    </GroupDataContext.Provider>
                  )
                : null}
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
