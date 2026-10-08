import { useLayoutEffect } from 'react'
import { blockingOverlayActions } from '../actions/overlay-actions.js'

/** Registers the overlay before keyboard input can reach the workspace. */
export default function Overlay({
  kind,
  actions = blockingOverlayActions,
  registerActionAdapter,
  children,
}) {
  useLayoutEffect(() => registerActionAdapter(kind, actions), [
    actions,
    kind,
    registerActionAdapter,
  ])

  return children
}
