import { useCallback, useEffect, useState } from 'react'
import type { DatasetAppProps } from '@/components/app/dataset-app-types'
import { DatasetShell } from '@/components/app/dataset-shell'
import { CompareView } from '@/components/dashboard/compare/compare-view'
import type { PackStatus } from '@/types/datapack'
import { parseCompareIds, toggleCompareId } from '@/lib/routes'
import { RouterProvider, useSearchParams } from '@/lib/router-compat'
import { isMemberOnly } from '@/lib/visibility'

export function CompareApp(props: DatasetAppProps) {
  return (
    <RouterProvider params={props.params} pathname={props.pathname} search={props.search}>
      <DatasetShell {...props}>
        <CompareBody {...props} />
      </DatasetShell>
    </RouterProvider>
  )
}

function CompareBody({ dataset, rows, compareDensities }: DatasetAppProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [densities, setDensities] = useState(() => new Map(Object.entries(compareDensities)))
  const [status, setStatus] = useState<PackStatus>('ready')
  const [packError, setPackError] = useState<string | null>(null)

  const hasParam = searchParams.has('ids')
  const urlIds = parseCompareIds(searchParams.get('ids'))
  const validIds = urlIds.filter(id => rows.some(row => row.videoId === id))
  const selectedIds = hasParam ? validIds : rows.slice(0, 3).map(row => row.videoId)
  const selectedKey = selectedIds.join(',')
  // 带 key 访问时会员限定场的 pack 也放行；否则跳过它们，避免 404 拖垮整页曲线。
  const accessKey = searchParams.get('key')
  const accessSuffix = accessKey ? `?key=${encodeURIComponent(accessKey)}` : ''

  const writeIds = useCallback((ids: string[]) => {
    const params = new URLSearchParams(searchParams)
    params.set('ids', ids.join(','))
    setSearchParams(params, { replace: true })
  }, [searchParams, setSearchParams])

  // 切换对比场次时只按需拉缺失的逐分钟密度，首屏已经带上的不再请求。
  useEffect(() => {
    const missing = (selectedKey ? selectedKey.split(',') : []).filter((id) => {
      if (densities.has(id)) return false
      if (accessKey) return true
      const row = rows.find(item => item.videoId === id)
      return !isMemberOnly(row?.availability)
    })
    if (missing.length === 0) return

    let cancelled = false
    // oxlint-disable-next-line react/set-state-in-effect -- 选择变化后要立刻显示加载态
    setStatus('loading')
    setPackError(null)

    const query = missing.map(encodeURIComponent).join(',')
    fetch(`/api/densities/${encodeURIComponent(dataset.id)}?ids=${query}${accessSuffix}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('逐分钟明细加载失败')
        return (await response.json()) as {
          densities?: Record<string, number[]>
          locked?: string[]
        }
      })
      .then((payload) => {
        if (cancelled) return
        const payloadDensities = payload.densities ?? {}
        const locked = new Set(payload.locked ?? [])
        setDensities((previous) => {
          const next = new Map(previous)
          // 受限场次记为已加载空值，避免同一请求反复触发；页面按 availability 显示会员限定。
          for (const videoId of missing)
            next.set(videoId, locked.has(videoId) ? [] : (payloadDensities[videoId] ?? []))
          return next
        })
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setPackError(error instanceof Error ? error.message : String(error))
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [accessKey, accessSuffix, dataset.id, densities, rows, selectedKey])

  return (
    <CompareView
      datasetLabel={dataset.label}
      densities={densities}
      onReset={() => writeIds([])}
      onToggle={videoId => writeIds(toggleCompareId(selectedIds, videoId))}
      packError={packError}
      packStatus={status}
      rows={rows}
      selectedIds={selectedIds}
    />
  )
}
