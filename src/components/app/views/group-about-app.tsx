import type { GroupAppProps } from '@/components/app/group-app-types'
import { GroupShell } from '@/components/app/group-shell'
import { GroupDataContext } from '@/components/dashboard/contexts/group-data-context'
import { GroupAboutPage } from '@/components/pages/group-about-page'
import { RouterProvider } from '@/lib/router-compat'

export function GroupAboutApp(props: GroupAppProps) {
  return (
    <RouterProvider params={props.params} pathname={props.pathname} search={props.search}>
      <GroupShell {...props}>
        {props.data
          ? (
              <GroupDataContext.Provider value={props.data}>
                <GroupAboutPage />
              </GroupDataContext.Provider>
            )
          : null}
      </GroupShell>
    </RouterProvider>
  )
}
