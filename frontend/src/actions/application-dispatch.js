import {
  ActionScope,
  applicationActionCatalog,
} from './application-actions.js'

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
 * Global actions are resolved centrally. Contextual actions are offered only
 * to the adapter for the active workspace surface, with surface-specific
 * actions additionally requiring that matching surface to be active.
 */
export function createApplicationDispatcher({
  getActiveSurface,
  getSurfaceActions,
  globalActions = {},
}) {
  if (typeof getActiveSurface !== 'function') {
    throw new TypeError('Application dispatch requires an active-surface reader')
  }
  if (typeof getSurfaceActions !== 'function') {
    throw new TypeError('Application dispatch requires a surface-action reader')
  }

  return (action, count = 1) => {
    const definition = applicationActionCatalog[action]
    if (!definition) return false

    if (definition.scope === ActionScope.GLOBAL) {
      return invokeAction(globalActions, action, count)
    }

    const activeSurface = getActiveSurface()
    if (
      definition.scope !== ActionScope.ACTIVE_SURFACE &&
      definition.scope !== activeSurface
    ) {
      return false
    }

    return invokeAction(getSurfaceActions(activeSurface), action, count)
  }
}
