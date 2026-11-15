import type { DatasetAppProps } from '@/components/app/dataset-app-types'
import { DatasetShell } from '@/components/app/dataset-shell'
import { TrendsPage } from '@/components/pages/trends-page'
import { RouterProvider } from '@/lib/router-compat'

export function TrendsApp(props: DatasetAppProps) {
  return (
    <RouterProvider params={props.params} pathname={props.pathname} search={props.search}>
      <DatasetShell {...props}>
        <TrendsPage />
      </DatasetShell>
    </RouterProvider>
  )
}
