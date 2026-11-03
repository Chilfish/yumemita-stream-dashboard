import { useSyncExternalStore } from 'react'

function subscribe() {
  return () => {}
}

/** 服务端与首次客户端渲染返回 false，水合后返回 true。 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
}
