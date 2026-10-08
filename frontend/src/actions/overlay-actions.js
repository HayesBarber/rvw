export const OverlayKind = Object.freeze({
  FILE_FINDER: 'file_finder',
  CODEBASE_SEARCH: 'codebase_search',
  KEYMAP_REFERENCE: 'keymap_reference',
})

// An empty adapter blocks workspace actions while an overlay is open.
export const blockingOverlayActions = Object.freeze({})

/** Adapter updates preserve the order in which overlays were opened. */
export function createOverlayActionRegistry() {
  const registrations = new Set()
  return Object.freeze({
    get() {
      let actions = null
      for (const registration of registrations) actions = registration.actions
      return actions
    },
    register(kind) {
      if (!Object.values(OverlayKind).includes(kind)) {
        throw new TypeError(`Unknown overlay kind: ${kind}`)
      }
      const registration = { actions: blockingOverlayActions }
      registrations.add(registration)
      return Object.freeze({
        update(actions) {
          if (!actions || typeof actions !== 'object' || Array.isArray(actions)) {
            throw new TypeError('Overlay action adapters must be objects')
          }
          registration.actions = actions
        },
        unregister() {
          registrations.delete(registration)
        },
      })
    },
  })
}
