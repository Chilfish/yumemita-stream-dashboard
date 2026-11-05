import { useEffect } from 'react'
import { useAppConfigStore } from '@/stores/appConfig'

interface ThemeProviderProps {
  children?: React.ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const theme = useAppConfigStore(state => state.theme)

  useEffect(() => {
    const root = window.document.documentElement

    root.classList.remove('light', 'dark')

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      root.classList.add(systemTheme)
    }
    else {
      root.classList.add(theme)
    }
  }, [theme])

  useEffect(() => {
    if (theme !== 'system')
      return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const handleChange = () => {
      const root = window.document.documentElement
      root.classList.remove('light', 'dark')
      root.classList.add(mediaQuery.matches ? 'dark' : 'light')
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  return <>{children}</>
}
