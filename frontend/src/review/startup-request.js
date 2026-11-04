import { RequestStatus } from './request-state.js'
import { reviewTransport } from './transport.js'

export function createStartupRequest({ initialize = reviewTransport.initialize } = {}) {
  let state = { status: RequestStatus.LOADING, error: null, attempt: 0 }
  let pending = null
  const listeners = new Set()
  const publish = (next) => {
    state = next
    for (const listener of listeners) listener()
  }

  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    load() {
      if (pending) return pending
      publish({ status: RequestStatus.LOADING, error: null, attempt: state.attempt + 1 })
      pending = Promise.resolve().then(initialize).then(() => {
        publish({ ...state, status: RequestStatus.SUCCESS })
      }).catch((error) => {
        publish({ ...state, status: RequestStatus.ERROR, error: error.message })
      }).finally(() => { pending = null })
      return pending
    },
  })
}
