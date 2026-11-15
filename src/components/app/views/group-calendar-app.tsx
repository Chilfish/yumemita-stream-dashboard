import type { GroupAppProps } from '@/components/app/group-app-types'
import { GroupShell } from '@/components/app/group-shell'
import { GroupCalendarPage } from '@/components/pages/group-calendar-page'
import { RouterProvider } from '@/lib/router-compat'

export function GroupCalendarApp(props: GroupAppProps) {
  return (
    <RouterProvider params={props.params} pathname={props.pathname} search={props.search}>
      <GroupShell {...props}>
        {props.calendar
          ? <GroupCalendarPage basePath={props.pathname} calendar={props.calendar} />
          : null}
      </GroupShell>
    </RouterProvider>
  )
}
