import type { DatasetAppProps } from '@/components/app/dataset-app-types'
import { DatasetShell } from '@/components/app/dataset-shell'
import { StreamsPage } from '@/components/pages/streams-page'
import { RouterProvider } from '@/lib/router-compat'

export function StreamsApp(props: DatasetAppProps) {
  return (
    <RouterProvider params={props.params} pathname={props.pathname} search={props.search}>
      <DatasetShell {...props}>
        <StreamsPage />
      </DatasetShell>
    </RouterProvider>
  )
}
