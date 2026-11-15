import type { DatasetTotals } from '@/lib/aggregate'
import type { ViewKey } from '@/lib/routes'
import type { TranscriptFile, TranscriptIndexEntry } from '@/lib/transcripts'
import type { CalendarPageData } from '@/types/calendar'
import type { StreamDatapack } from '@/types/datapack'
import type { DatasetIndexEntry, StreamNavItem, StreamSummary } from '@/types/dataset'

export type DatasetView =
  | 'home'
  | 'streams'
  | 'calendar'
  | 'trends'
  | 'gallery'
  | 'transcripts'
  | 'compare'
  | 'stream'

export interface DatasetAppProps {
  datasets: DatasetIndexEntry[]
  dataset: DatasetIndexEntry
  rows: StreamSummary[]
  /** 日历页不读全量 pack，因此允许为空；正文也不需要 `DatasetViewContext`。 */
  totals: DatasetTotals | null
  calendar?: CalendarPageData | null
  view: DatasetView
  section: ViewKey
  pathname: string
  search: string
  params: Record<string, string>
  stream: StreamSummary | null
  /** 单场页只传标题级索引；其余页面缺省时直接复用 `rows`。 */
  navItems?: StreamNavItem[]
  pack: StreamDatapack | null
  compareDensities: Record<string, number[]>
  transcripts?: TranscriptIndexEntry[]
  transcriptError?: string | null
  hasTranscript?: boolean
  /** 首屏即逐字稿时由服务端预渲染的正文，省掉水合后的一次往返。 */
  initialTranscript?: TranscriptFile | null
  /** 会员限定单场：复用详情页外壳，正文换成公开范围说明。 */
  locked?: boolean
}
