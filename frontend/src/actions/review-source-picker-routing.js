import { ApplicationAction } from './application-actions.js'

/** Forward overlay actions to the current mode. Clear it before changing modes. */
export function createReviewSourcePickerActionRouter() {
  let current = null
  const actions = Object.freeze(Object.fromEntries(
    Object.values(ApplicationAction).map((action) => [action, (count) => {
      const handler = current?.actions[action]
      return typeof handler === 'function' && handler(count) === true
    }]),
  ))

  return Object.freeze({
    actions,
    register(actions) {
      if (!actions || typeof actions !== 'object' || Array.isArray(actions)) {
        throw new TypeError('Picker mode action adapters must be objects')
      }
      const registration = { actions }
      current = registration
      return () => {
        if (current === registration) current = null
      }
    },
    clear() {
      current = null
    },
  })
}
