import type { DatasetAppProps } from '@/components/app/dataset-app-types'
import { DatasetShell } from '@/components/app/dataset-shell'
import { CalendarPage } from '@/components/pages/calendar-page'
import { RouterProvider } from '@/lib/router-compat'

export function CalendarApp(props: DatasetAppProps) {
  return (
    <RouterProvider params={props.params} pathname={props.pathname} search={props.search}>
      <DatasetShell {...props}>
        <CalendarPage basePath={props.pathname} data={props.calendar ?? null} />
      </DatasetShell>
    </RouterProvider>
  )
}
