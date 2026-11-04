import { createContext, useCallback, useContext, useMemo } from 'react'

/**
 * React Router → Astro 兼容层的状态与 hooks。
 * 组件部分在 `src/components/shared/router-compat.tsx`，barrel 见 `src/lib/router-compat.ts`。
 */

export interface RouterState {
  pathname: string
  search: string
  params: Record<string, string>
  navigate: (to: string) => void
  setSearch: (search: string) => void
}

export const RouterContext = createContext<RouterState | null>(null)

function useRouterStateValue(): RouterState {
  const value = useContext(RouterContext)
  if (!value) {
    throw new Error('useRouter must be used within RouterProvider')
  }
  return value
}

export async function navigateTo(to: string): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    const { navigate } = await import('astro:transitions/client')
    await navigate(to)
  }
  catch {
    window.location.assign(to)
  }
}

export function useLocation(): { pathname: string, search: string } {
  const { pathname, search } = useRouterStateValue()
  return { pathname, search }
}

export function useNavigate(): (to: string) => void {
  return useRouterStateValue().navigate
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useRouterStateValue().params as T
}

type SetSearchParams = (
  next: URLSearchParams | Record<string, string>,
  options?: { replace?: boolean },
) => void

export function useSearchParams(): [URLSearchParams, SetSearchParams] {
  const { search, setSearch } = useRouterStateValue()
  const params = useMemo(() => new URLSearchParams(search), [search])

  const setSearchParams = useCallback<SetSearchParams>((next) => {
    const value = next instanceof URLSearchParams ? next : new URLSearchParams(next)
    const query = value.toString()
    setSearch(query ? `?${query}` : '')
  }, [setSearch])

  return [params, setSearchParams]
}
