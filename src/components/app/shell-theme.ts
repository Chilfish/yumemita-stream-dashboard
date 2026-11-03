import { useEffect, useState } from 'react'
import { useAppConfigStore } from '@/stores/appConfig'

/** 侧栏主题开关：把 Zustand 的 light/dark/system 解析成当前实际主题。 */
export function useShellTheme(): { theme: 'light' | 'dark', onToggleTheme: () => void } {
  const choice = useAppConfigStore(state => state.theme)
  const setTheme = useAppConfigStore(state => state.setTheme)
  const [resolved, setResolved] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      setResolved(choice === 'system' ? (media.matches ? 'dark' : 'light') : choice)
    }
    apply()
    if (choice !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [choice])

  return {
    theme: resolved,
    onToggleTheme: () => setTheme(resolved === 'dark' ? 'light' : 'dark'),
  }
}
