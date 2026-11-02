import { listOpenPullRequests } from './api.js'
import { RequestStatus } from './request-state.js'

/** Owns one overlay's requests. Cancel when the overlay unmounts. */
export function createPullRequestsRequest({ list = listOpenPullRequests } = {}) {
  let state = { status: RequestStatus.IDLE, data: [], error: null }
  let generation = 0
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
    async load() {
      const requestId = ++generation
      publish({ status: RequestStatus.LOADING, data: [], error: null })
      try {
        const { pullRequests } = await list()
        if (requestId !== generation) return
        publish({ status: RequestStatus.SUCCESS, data: pullRequests, error: null })
      } catch (error) {
        if (requestId !== generation) return
        publish({ status: RequestStatus.ERROR, data: [], error: error.message })
      }
    },
    cancel() {
      generation += 1
    },
  })
}
