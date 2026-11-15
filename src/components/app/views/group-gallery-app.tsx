import type { GroupAppProps } from '@/components/app/group-app-types'
import { GroupShell } from '@/components/app/group-shell'
import { GroupDataContext } from '@/components/dashboard/contexts/group-data-context'
import { GroupGalleryPage } from '@/components/pages/group-gallery-page'
import { RouterProvider } from '@/lib/router-compat'

export function GroupGalleryApp(props: GroupAppProps) {
  return (
    <RouterProvider params={props.params} pathname={props.pathname} search={props.search}>
      <GroupShell {...props}>
        {props.data
          ? (
              <GroupDataContext.Provider value={props.data}>
                <GroupGalleryPage today={props.today ?? ''} todayMonthDay={props.todayMonthDay ?? ''} />
              </GroupDataContext.Provider>
            )
          : null}
      </GroupShell>
    </RouterProvider>
  )
}
