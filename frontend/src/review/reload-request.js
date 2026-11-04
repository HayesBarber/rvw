import { useMemo, useState, useSyncExternalStore } from 'react'

import { reloadReview } from './api.js'
import { RequestStatus } from './request-state.js'

const idleRequest = Object.freeze({
  status: RequestStatus.IDLE,
  data: null,
  error: null,
})

export function reloadRequestMessage(request) {
  if (request.status === RequestStatus.LOADING) return 'Reloading…'
  if (request.status === RequestStatus.ERROR) return request.error
  return ''
}

export function createReloadReviewRequest({
  replace = reloadReview,
  reloadDocument = () => window.location.reload(),
} = {}) {
  let state = idleRequest
  let pending = false
  let replacement = null
  const listeners = new Set()
  const publish = (next) => {
    state = next
    for (const listener of listeners) listener()
  }

  async function run(source) {
    try {
      replacement ??= await replace(source)
      // Keep submissions blocked until the old document has gone away.
      reloadDocument()
    } catch (error) {
      pending = false
      publish({ status: RequestStatus.ERROR, data: replacement, error: error.message })
    }
  }

  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    reload(source) {
      if (pending) return true
      pending = true
      publish({ status: RequestStatus.LOADING, data: replacement, error: null })
      // After a navigation failure, retry only navigation. Replacement already succeeded.
      void run(source)
      return true
    },
  })
}

export function useReloadReview() {
  const [request] = useState(createReloadReviewRequest)
  const state = useSyncExternalStore(request.subscribe, request.getSnapshot, request.getSnapshot)
  return useMemo(() => ({ ...state, reload: request.reload }), [request, state])
}
