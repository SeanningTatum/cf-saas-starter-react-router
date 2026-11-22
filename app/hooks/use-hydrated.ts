import { useSyncExternalStore } from "react"

const subscribe = () => () => {}

/**
 * False during server render and hydration, true once React has hydrated.
 * Gate controls whose handlers only exist after hydration (e.g. a submit
 * button whose form posts through JS) so an early click does nothing.
 */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
}
