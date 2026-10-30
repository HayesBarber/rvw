import { blockingOverlayActions } from './overlay-actions.js'

/** Publish the current mode's adapter. Old cleanup cannot remove a newer one. */
export function createReviewSourcePickerModeActionRegistry(onChange) {
  let current = null

  return Object.freeze({
    register(actions) {
      if (!actions || typeof actions !== 'object' || Array.isArray(actions)) {
        throw new TypeError('Picker mode action adapters must be objects')
      }
      const registration = { actions }
      current = registration
      onChange(actions)
      return () => {
        if (current !== registration) return
        current = null
        onChange(blockingOverlayActions)
      }
    },
    clear() {
      current = null
      onChange(blockingOverlayActions)
    },
  })
}
