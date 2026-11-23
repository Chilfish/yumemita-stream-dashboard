import { classifyTitle } from '@/lib/classify'
import type { SortDirection, StreamTypeFilter, TableSortKey } from '@/lib/table-params'
import { isSortDirection, isStreamTypeFilter, isTableSortKey } from '@/lib/table-params'
import type { StreamSearchItem, StreamSummary } from '@/types/dataset'

/**
 * `/api/streams` 的查询参数解析。
 *
 * 页面上的搜索是浏览器端过滤整份列表；接口面向 Agent，参数非法时直接报错，
 * 而不是静默回退，避免下游拿错字段却以为筛选生效。
 */

export const STREAM_AVAILABILITY_FILTERS = ['all', 'public', 'subscriber_only'] as const

export type StreamAvailabilityFilter = (typeof STREAM_AVAILABILITY_FILTERS)[number]

export const STREAM_SEARCH_DEFAULT_LIMIT = 50
export const STREAM_SEARCH_MAX_LIMIT = 200
const MAX_OFFSET = 100_000
const MAX_QUERY_CHARS = 120
const MAX_MEMBERS = 50
const MEMBER_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export interface StreamSearchParams {
  /** 标题 / videoId 子串，或完整日期 `YYYY-MM-DD`。 */
  q: string
  /** 空数组 = 不过滤。命中规则与成员页一致：owner 或参与者。 */
  members: string[]
  type: StreamTypeFilter
  /** JST 日期，闭区间。 */
  from: string | null
  to: string | null
  availability: StreamAvailabilityFilter
  sort: TableSortKey
  dir: SortDirection
  limit: number
  offset: number
}

export interface ParsedStreamSearchParams {
  params: StreamSearchParams
  error: string | null
}

function isValidIsoDay(value: string): boolean {
  if (!ISO_DAY_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function parseInteger(
  raw: string | null,
  fallback: number,
  field: string,
  min: number,
  max: number,
): { value: number; error: string | null } {
  if (raw == null || raw.trim() === '') return { value: fallback, error: null }
  if (!/^\d+$/.test(raw.trim())) {
    return { value: fallback, error: `${field} 必须是整数` }
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    return { value: fallback, error: `${field} 必须在 ${min}–${max} 之间` }
  }
  return { value, error: null }
}

function parseMembers(searchParams: URLSearchParams): { members: string[]; error: string | null } {
  const ids: string[] = []
  for (const value of [...searchParams.getAll('member'), ...searchParams.getAll('members')]) {
    for (const part of value.split(',')) {
      const id = part.trim()
      if (!id) continue
      if (!MEMBER_ID_PATTERN.test(id)) {
        return { members: [], error: `member 包含非法 id：${id}` }
      }
      if (!ids.includes(id)) ids.push(id)
    }
  }
  if (ids.length > MAX_MEMBERS) {
    return { members: [], error: `member 最多 ${MAX_MEMBERS} 个` }
  }
  return { members: ids, error: null }
}

export function parseStreamSearchParams(searchParams: URLSearchParams): ParsedStreamSearchParams {
  const defaults: StreamSearchParams = {
    q: '',
    members: [],
    type: 'all',
    from: null,
    to: null,
    availability: 'all',
    sort: 'date',
    dir: 'desc',
    limit: STREAM_SEARCH_DEFAULT_LIMIT,
    offset: 0,
  }

  const q = (searchParams.get('q') ?? '').trim()
  if (q.length > MAX_QUERY_CHARS) {
    return { params: defaults, error: `q 最多 ${MAX_QUERY_CHARS} 个字符` }
  }

  const members = parseMembers(searchParams)
  if (members.error) return { params: defaults, error: members.error }

  const type = searchParams.get('type')
  if (type != null && !isStreamTypeFilter(type)) {
    return { params: defaults, error: 'type 必须是 sing / event / talk / game / all' }
  }

  const sort = searchParams.get('sort')
  if (sort != null && !isTableSortKey(sort)) {
    return { params: defaults, error: 'sort 取值不在允许的排序字段内' }
  }

  const dir = searchParams.get('dir')
  if (dir != null && !isSortDirection(dir)) {
    return { params: defaults, error: 'dir 必须是 asc 或 desc' }
  }

  const availability = searchParams.get('availability')
  if (
    availability != null
    && !(STREAM_AVAILABILITY_FILTERS as readonly string[]).includes(availability)
  ) {
    return { params: defaults, error: 'availability 必须是 all / public / subscriber_only' }
  }

  const from = searchParams.get('from')
  if (from != null && !isValidIsoDay(from)) {
    return { params: defaults, error: 'from 必须是有效的 YYYY-MM-DD 日期' }
  }

  const to = searchParams.get('to')
  if (to != null && !isValidIsoDay(to)) {
    return { params: defaults, error: 'to 必须是有效的 YYYY-MM-DD 日期' }
  }

  if (from && to && from > to) {
    return { params: defaults, error: 'from 不能晚于 to' }
  }

  const limit = parseInteger(
    searchParams.get('limit'),
    STREAM_SEARCH_DEFAULT_LIMIT,
    'limit',
    1,
    STREAM_SEARCH_MAX_LIMIT,
  )
  if (limit.error) return { params: defaults, error: limit.error }

  const offset = parseInteger(searchParams.get('offset'), 0, 'offset', 0, MAX_OFFSET)
  if (offset.error) return { params: defaults, error: offset.error }

  return {
    params: {
      q,
      members: members.members,
      type: (type ?? defaults.type) as StreamTypeFilter,
      from,
      to,
      availability: (availability ?? defaults.availability) as StreamAvailabilityFilter,
      sort: (sort ?? defaults.sort) as TableSortKey,
      dir: (dir ?? defaults.dir) as SortDirection,
      limit: limit.value,
      offset: offset.value,
    },
    error: null,
  }
}

/** 把摘要补成搜索条目：显式带内容类型与可继续读取的链接。 */
export function toStreamSearchItem(
  summary: StreamSummary & { datasetId: string },
  origin: string,
): StreamSearchItem {
  const base = (origin ?? '').replace(/\/+$/, '')
  const datasetId = encodeURIComponent(summary.datasetId)
  const videoId = encodeURIComponent(summary.videoId)
  const html = `${base}/${datasetId}/stream/${videoId}`

  return {
    ...summary,
    participants: summary.participants ?? [],
    type: classifyTitle(summary.title).key,
    links: {
      html,
      markdown: `${html}.md`,
      pack: `${base}/api/packs/${datasetId}/${videoId}`,
    },
  }
}
