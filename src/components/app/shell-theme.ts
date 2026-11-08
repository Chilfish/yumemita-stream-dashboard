import { useSyncExternalStore } from 'react'
import { useAppConfigStore } from '@/stores/appConfig'

const MEDIA_QUERY = '(prefers-color-scheme: dark)'

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const media = window.matchMedia(MEDIA_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function resolveTheme(choice: 'light' | 'dark' | 'system'): 'light' | 'dark' {
  if (choice !== 'system') return choice
  return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light'
}

/** 侧栏主题开关：与 ThemeProvider 共用同一个 store，不另写一份解析状态。 */
export function useShellTheme(): { theme: 'light' | 'dark', onToggleTheme: () => void } {
  const choice = useAppConfigStore(state => state.theme)
  const setTheme = useAppConfigStore(state => state.setTheme)

  // 服务端快照固定 light，水合后再按系统偏好纠正，避免第一帧图标错误。
  const theme = useSyncExternalStore(
    subscribe,
    () => resolveTheme(choice),
    () => 'light' as const,
  )

  return {
    theme,
    // 两态开关会把「跟随系统」切成具体主题；需要恢复时用主题菜单重新选择。
    onToggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
  }
}
