import type { CollaborationStream } from '@/lib/collaboration'
import type { GroupData } from '@/lib/group'
import type { GroupViewKey } from '@/lib/routes'
import type { CalendarPageData, DayPlan } from '@/types/calendar'
import type { GroupCompareData } from '@/types/compare'
import type { DatasetIndexEntry } from '@/types/dataset'
import type { GroupStreamSummary } from '@/types/group'

export type GroupView = 'home' | 'gallery' | 'about' | 'compare' | 'calendar'

export interface GroupAppProps {
  datasets: DatasetIndexEntry[]
  data: GroupData | null
  compare: GroupCompareData | null
  calendar?: CalendarPageData | null
  dayPlan?: DayPlan | null
  /** JST 今天 `YYYY-MM-DD`；相册用它排除今天的场次。 */
  today?: string
  /** JST 今天的 `MM-DD`；「那年今日」的默认筛选。 */
  todayMonthDay?: string
  /** 组首页「那年今日」的往期场次。 */
  onThisDay?: GroupStreamSummary[]
  /** 组首页联动关系视图的场次；其他页面为空。 */
  collaborations?: CollaborationStream[]
  view: GroupView
  section: GroupViewKey
  pathname: string
  search: string
  params: Record<string, string>
}
