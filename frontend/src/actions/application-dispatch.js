// Routes semantic actions to the currently active application surface.

function invokeAction(actions, action, count) {
  const handler = actions?.[action]
  return typeof handler === 'function' && handler(count) === true
}

/**
 * Stores the action adapter currently exposed by each workspace surface.
 * Registration returns a guarded cleanup function so React Strict Mode cannot
 * unregister a newer adapter while disposing an older render.
 */
export function createSurfaceActionRegistry() {
  const adapters = new Map()

  return Object.freeze({
    get(surface) {
      return adapters.get(surface) ?? null
    },
    register(surface, adapter) {
      if (typeof surface !== 'string' || surface.length === 0) {
        throw new TypeError('Surface action adapters require a surface')
      }
      if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)) {
        throw new TypeError('Surface action adapters must be objects')
      }

      adapters.set(surface, adapter)
      return () => {
        if (adapters.get(surface) === adapter) adapters.delete(surface)
      }
    },
  })
}

/**
 * Creates the single application-level semantic action dispatcher.
 *
 * An active overlay receives all actions first so commands cannot leak to the
 * workspace behind it. Otherwise, the active surface handler takes priority.
 * A global handler is used only when the surface handler is absent.
 */
export function createApplicationDispatcher({
  getActiveSurface,
  getSurfaceActions,
  getOverlayActions = () => null,
  globalActions = {},
}) {
  if (typeof getActiveSurface !== 'function') {
    throw new TypeError('Application dispatch requires an active-surface reader')
  }
  if (typeof getSurfaceActions !== 'function') {
    throw new TypeError('Application dispatch requires a surface-action reader')
  }
  if (typeof getOverlayActions !== 'function') {
    throw new TypeError('Application dispatch requires an overlay-action reader')
  }

  return (actionOrActions, count = 1) => {
    const actions = Array.isArray(actionOrActions)
      ? actionOrActions
      : [actionOrActions]
    const overlayActions = getOverlayActions()
    if (overlayActions) {
      return actions.some((action) => (
        invokeAction(overlayActions, action, count)
      ))
    }

    const activeSurface = getActiveSurface()
    const surfaceActions = getSurfaceActions(activeSurface)
    for (const action of actions) {
      const adapter = typeof surfaceActions?.[action] === 'function'
        ? surfaceActions
        : globalActions
      if (invokeAction(adapter, action, count)) return true
    }
    return false
  }
}
