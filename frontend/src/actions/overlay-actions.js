export const OverlayKind = Object.freeze({
  FILE_FINDER: 'file_finder',
  CODEBASE_SEARCH: 'codebase_search',
  KEYMAP_REFERENCE: 'keymap_reference',
  REVIEW_SOURCE_PICKER: 'review_source_picker',
  COMMENTS: 'comments',
})

// An empty adapter blocks workspace actions while an overlay is open.
export const blockingOverlayActions = Object.freeze({})

/** Adapter updates preserve the order in which overlays were opened. */
export function createOverlayActionRegistry() {
  const registrations = new Set()
  const listeners = new Set()
  const notify = () => { for (const listener of listeners) listener() }
  return Object.freeze({
    isOpen() {
      return registrations.size > 0
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
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
      notify()
      return Object.freeze({
        update(actions) {
          if (!actions || typeof actions !== 'object' || Array.isArray(actions)) {
            throw new TypeError('Overlay action adapters must be objects')
          }
          registration.actions = actions
        },
        unregister() {
          if (registrations.delete(registration)) notify()
        },
      })
    },
  })
}
