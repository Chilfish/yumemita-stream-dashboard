import type { GroupAppProps } from '@/components/app/group-app-types'
import { GroupShell } from '@/components/app/group-shell'
import { GroupDataContext } from '@/components/dashboard/contexts/group-data-context'
import { GroupHomePage } from '@/components/pages/group-home-page'
import { RouterProvider } from '@/lib/router-compat'

export function GroupHomeApp(props: GroupAppProps) {
  return (
    <RouterProvider params={props.params} pathname={props.pathname} search={props.search}>
      <GroupShell {...props}>
        {props.data
          ? (
              <GroupDataContext.Provider value={props.data}>
                <GroupHomePage
                  collaborations={props.collaborations ?? []}
                  dayPlan={props.dayPlan}
                  monthDay={props.todayMonthDay ?? ''}
                  onThisDay={props.onThisDay ?? []}
                />
              </GroupDataContext.Provider>
            )
          : null}
      </GroupShell>
    </RouterProvider>
  )
}
