import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RouterContext, navigateTo } from '@/lib/router-state'

export function RouterProvider({
  pathname,
  search,
  params = {},
  children,
}: {
  pathname: string
  search: string
  params?: Record<string, string>
  children: ReactNode
}) {
  const [currentPathname, setCurrentPathname] = useState(pathname)
  const [currentSearch, setCurrentSearch] = useState(search)
  const searchRef = useRef(search)

  // 浏览器前进/后退与 Astro 客户端导航后，同步 pathname 与 search。
  useEffect(() => {
    const sync = (): void => {
      const nextSearch = window.location.search
      searchRef.current = nextSearch
      setCurrentPathname(window.location.pathname)
      setCurrentSearch(nextSearch)
    }
    window.addEventListener('popstate', sync)
    document.addEventListener('astro:page-load', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      document.removeEventListener('astro:page-load', sync)
    }
  }, [])

  const navigate = useCallback((to: string) => {
    void navigateTo(to)
  }, [])

  const setSearch = useCallback((next: string | ((previous: string) => string)) => {
    const value = typeof next === 'function' ? next(searchRef.current) : next
    searchRef.current = value
    setCurrentSearch(value)
    if (typeof window === 'undefined') return
    const query = value.startsWith('?') ? value : value ? `?${value}` : ''
    window.history.replaceState(null, '', `${window.location.pathname}${query}`)
  }, [])

  const value = useMemo(
    () => ({ pathname: currentPathname, search: currentSearch, params, navigate, setSearch }),
    [currentPathname, currentSearch, params, navigate, setSearch],
  )

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string
  children?: ReactNode
}

export function Link({ to, children, ...props }: LinkProps) {
  return <a href={to} {...props}>{children}</a>
}

export const NavLink = Link
