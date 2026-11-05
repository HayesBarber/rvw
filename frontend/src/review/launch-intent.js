import { acknowledgeLaunchIntent, getLaunchIntent } from './api.js'

/** One controller belongs to one frontend document. Core owns the pending flag. */
export function createLaunchIntent({ read = getLaunchIntent, acknowledge = acknowledgeLaunchIntent } = {}) {
  let opened = false
  let acknowledgement = null

  return Object.freeze({
    async read() {
      if (opened) return false
      const intent = await read()
      if (typeof intent?.openReviewSourcePicker !== 'boolean') {
        throw new Error('The rvw service returned an invalid launch instruction')
      }
      return !opened && intent.openReviewSourcePicker
    },
    acknowledge() {
      opened = true
      // Effect restarts must not submit the same acknowledgement twice.
      acknowledgement ??= Promise.resolve().then(acknowledge).catch((error) => {
        acknowledgement = null
        throw error
      })
      return acknowledgement
    },
  })
}

export const reviewLaunchIntent = createLaunchIntent()
