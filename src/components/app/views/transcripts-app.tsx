import type { DatasetAppProps } from '@/components/app/dataset-app-types'
import { DatasetShell } from '@/components/app/dataset-shell'
import { TranscriptsPage } from '@/components/pages/transcripts-page'
import { RouterProvider } from '@/lib/router-compat'

export function TranscriptsApp(props: DatasetAppProps) {
  return (
    <RouterProvider params={props.params} pathname={props.pathname} search={props.search}>
      <DatasetShell {...props}>
        <TranscriptsPage
          error={props.transcriptError ?? null}
          transcripts={props.transcripts ?? []}
        />
      </DatasetShell>
    </RouterProvider>
  )
}
