import { createContext, useContext, useSyncExternalStore } from 'react'

/**
 * React-facing access to a VimController.
 *
 * The provider lives in react.jsx because it also owns browser keyboard
 * capture. This module contains only the shared context and consumer hooks.
 * Components can use useVimController for dispatch/command APIs, or
 * useVimState when they need to re-render as mode, count, or pending keys
 * change.
 */
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
