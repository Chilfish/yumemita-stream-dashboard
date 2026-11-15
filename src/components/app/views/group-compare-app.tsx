import type { GroupAppProps } from '@/components/app/group-app-types'
import { GroupShell } from '@/components/app/group-shell'
import { GroupComparePage } from '@/components/pages/group-compare-page'
import { RouterProvider } from '@/lib/router-compat'

export function GroupCompareApp(props: GroupAppProps) {
  return (
    <RouterProvider params={props.params} pathname={props.pathname} search={props.search}>
      <GroupShell {...props}>
        {props.compare
          ? <GroupComparePage data={props.compare} datasets={props.datasets} />
          : null}
      </GroupShell>
    </RouterProvider>
  )
}
