import type { DatasetAppProps } from '@/components/app/dataset-app-types'
import { DatasetShell } from '@/components/app/dataset-shell'
import { GalleryPage } from '@/components/pages/gallery-page'
import { RouterProvider } from '@/lib/router-compat'

export function GalleryApp(props: DatasetAppProps) {
  return (
    <RouterProvider params={props.params} pathname={props.pathname} search={props.search}>
      <DatasetShell {...props}>
        <GalleryPage />
      </DatasetShell>
    </RouterProvider>
  )
}
