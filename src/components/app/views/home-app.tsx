import type { DatasetAppProps } from '@/components/app/dataset-app-types'
import { DatasetShell } from '@/components/app/dataset-shell'
import { HomePage } from '@/components/pages/home-page'
import { RouterProvider } from '@/lib/router-compat'

export function HomeApp(props: DatasetAppProps) {
  return (
    <RouterProvider params={props.params} pathname={props.pathname} search={props.search}>
      <DatasetShell {...props}>
        <HomePage />
      </DatasetShell>
    </RouterProvider>
  )
}
