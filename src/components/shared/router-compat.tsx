import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'
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
  const [currentSearch, setCurrentSearch] = useState(search)

  const navigate = useCallback((to: string) => {
    void navigateTo(to)
  }, [])

  const setSearch = useCallback((next: string) => {
    setCurrentSearch(next)
    if (typeof window === 'undefined') return
    const query = next.startsWith('?') ? next : next ? `?${next}` : ''
    window.history.replaceState(null, '', `${window.location.pathname}${query}`)
  }, [])

  const value = useMemo(
    () => ({ pathname, search: currentSearch, params, navigate, setSearch }),
    [pathname, currentSearch, params, navigate, setSearch],
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
