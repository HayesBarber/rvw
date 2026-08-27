import { createContext, useContext, useSyncExternalStore } from 'react'

export const VimContext = createContext(null)

export function useVimController() {
  const controller = useContext(VimContext)
  if (!controller) throw new Error('useVimController must be used inside VimProvider')
  return controller
}

export function useVimState() {
  const controller = useVimController()
  return useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
}
